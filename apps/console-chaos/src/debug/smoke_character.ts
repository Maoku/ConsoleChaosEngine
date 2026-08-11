/**
 * T0-19：プレイヤーモデル（3D）の FC 量子化表示の初期確認。
 *
 * 本作のプレイヤーは**すべての世代で 3D モデル**であり、
 * 第1世代ではそれを量子化して表示する（GAME_PLAN §16-2：ドット絵への差し戻しはしない）。
 * したがって「量子化後もシルエットが読めるか」がキャラクター設計の制約になる。
 *
 * ここで確認したいのは造形の良し悪しではなく、
 * **低頭身・高コントラストという方針が量子化に耐えるか**という一点。
 */
import { DEFAULT_AMBIENT, DEFAULT_DIFFUSE } from '@/render/material';
import { mat4 } from 'gl-matrix';
import {
  createBuffer,
  createProgram,
  createStateCache,
  createTexture,
  createVertexArray,
  type GLContext,
  type StateCache,
  type Texture,
  type VertexArray,
} from '@/render/gl/index';
import { createCamera, type Camera } from '@/render/camera';
import { createPipeline, type Pipeline } from '@/render/pipeline';
import type { CrtQuality } from '@/render/postfx/presets';
import type { GenerationId, GenerationProfile } from '@/generation/profiles';
import { unitCube } from '@/render/geometry';
import ps1Vertex from '@/render/shaders/ps1_vertex.glsl?raw';
import ps1Fragment from '@/render/shaders/ps1_forward.glsl?raw';

type Vec3 = [number, number, number];
type Rgba = [number, number, number, number];

interface Part {
  name: string;
  center: Vec3;
  half: Vec3;
  color: Rgba;
}

/**
 * 低頭身（およそ 4 頭身）・高コントラストのプレイヤー像。
 * 頭と胴で明度差を大きく取り、手足の先端に明るい色を置いて動きを読ませる。
 */
const PARTS: Part[] = [
  { name: 'head', center: [0, 1.32, 0], half: [0.36, 0.3, 0.32], color: [0.98, 0.86, 0.72, 1] },
  { name: 'hair', center: [0, 1.56, -0.02], half: [0.38, 0.12, 0.34], color: [0.12, 0.14, 0.3, 1] },
  { name: 'torso', center: [0, 0.78, 0], half: [0.3, 0.28, 0.2], color: [0.9, 0.25, 0.3, 1] },
  { name: 'belt', center: [0, 0.5, 0], half: [0.3, 0.06, 0.21], color: [0.12, 0.14, 0.3, 1] },
  { name: 'armL', center: [-0.42, 0.82, 0], half: [0.12, 0.26, 0.13], color: [0.9, 0.25, 0.3, 1] },
  { name: 'armR', center: [0.42, 0.82, 0], half: [0.12, 0.26, 0.13], color: [0.9, 0.25, 0.3, 1] },
  { name: 'handL', center: [-0.42, 0.52, 0], half: [0.13, 0.1, 0.14], color: [0.98, 0.86, 0.72, 1] },
  { name: 'handR', center: [0.42, 0.52, 0], half: [0.13, 0.1, 0.14], color: [0.98, 0.86, 0.72, 1] },
  { name: 'legL', center: [-0.16, 0.24, 0], half: [0.13, 0.24, 0.14], color: [0.2, 0.35, 0.7, 1] },
  { name: 'legR', center: [0.16, 0.24, 0], half: [0.13, 0.24, 0.14], color: [0.2, 0.35, 0.7, 1] },
  { name: 'footL', center: [-0.16, 0.05, 0.04], half: [0.15, 0.06, 0.19], color: [0.95, 0.9, 0.35, 1] },
  { name: 'footR', center: [0.16, 0.05, 0.04], half: [0.15, 0.06, 0.19], color: [0.95, 0.9, 0.35, 1] },
];

export interface CharacterParams {
  generation: GenerationId;
  crtQuality: CrtQuality;
  /** モデルの回転（ラジアン）。シルエットを角度違いで見るため */
  yaw: number;
  /** 背景色。量子化後の分離を見るために変えられる */
  background: Rgba;
}

export interface SmokeCharacter {
  readonly params: CharacterParams;
  draw(screenWidth: number, screenHeight: number): void;
  dispose(): void;
}

export function createSmokeCharacter(ctx: GLContext): SmokeCharacter {
  const { gl } = ctx;
  const { vertices, indices } = unitCube();
  const stride = 8 * 4;
  const vbo = createBuffer(ctx, 'vertex', vertices);
  const ibo = createBuffer(ctx, 'index', indices);
  const vao: VertexArray = createVertexArray(
    ctx,
    [
      { location: 0, size: 3, buffer: vbo, strideBytes: stride, offsetBytes: 0 },
      { location: 1, size: 3, buffer: vbo, strideBytes: stride, offsetBytes: 12 },
      { location: 2, size: 2, buffer: vbo, strideBytes: stride, offsetBytes: 24 },
    ],
    { buffer: ibo, type: 'ushort' },
  );
  const program = createProgram(ctx, 'character', ps1Vertex, ps1Fragment);
  const texture: Texture = createTexture(ctx, {
    width: 2,
    height: 2,
    filter: 'nearest',
    data: new Uint8Array([255, 255, 255, 255, 235, 235, 235, 255, 235, 235, 235, 255, 255, 255, 255, 255]),
  });
  const state: StateCache = createStateCache(ctx);
  const camera: Camera = createCamera('perspective');
  const model = mat4.create();
  const params: CharacterParams = {
    generation: 'FC',
    crtQuality: 'full',
    yaw: 0.5,
    background: [0.16, 0.2, 0.34, 1],
  };
  const pipeline: Pipeline = createPipeline(ctx, { quality: () => params.crtQuality });

  function drawScene(profile: GenerationProfile): void {
    const video = profile.video;
    // キャラクターが画面の 6 割ほどを占める寄りの画角。
    // 第1世代の 256x224 でシルエットが読めるかを見るのが目的
    camera.projection = video.projection === 'ortho2d' ? 'ortho' : 'perspective';
    camera.orthoHeight = 2.6;
    camera.position[0] = 0;
    camera.position[1] = 0.85;
    camera.position[2] = 3.2;
    camera.target[0] = 0;
    camera.target[1] = 0.82;
    camera.target[2] = 0;
    camera.update(video.internalWidth / video.internalHeight);

    texture.setFilter(video.textureFilter);
    state.apply({
      depthTest: video.depthBuffer,
      depthWrite: video.depthBuffer,
      blend: 'none',
      cull: 'back',
    });
    // 背景。量子化はブロック単位なので、背景色によって読みやすさが変わる
    state.clear(params.background[0], params.background[1], params.background[2], 1, video.depthBuffer);
    program.use();

    const ordered = video.depthBuffer ? PARTS : [...PARTS].sort((a, b) => a.center[2] - b.center[2]);
    for (const part of ordered) {
      mat4.identity(model);
      mat4.rotateY(model, model, params.yaw);
      mat4.translate(model, model, part.center);
      mat4.scale(model, model, part.half);
      program.setUniforms({
        uModel: model as Float32Array,
        uViewProjection: camera.viewProjection as Float32Array,
        uResolution: [video.internalWidth, video.internalHeight],
        uQuantizeStep: video.vertexQuantize,
        uAffineAmount: video.affineTexture ? 1 : 0,
        uBaseColor: texture,
        uBaseColorFactor: part.color,
        uLightDirection: [0.35, 0.9, 0.7],
        // 陰影の既定値（T2-04 でシェーダの固定値を uniform にした）。検証シーンは松明を持たない
        uAmbient: DEFAULT_AMBIENT,
        uDiffuse: DEFAULT_DIFFUSE,
      });
      vao.bind();
      gl.drawElements(gl.TRIANGLES, indices.length, vao.indexType, 0);
    }
  }

  return {
    params,
    draw(screenWidth, screenHeight): void {
      pipeline.render(
        {
          generation: params.generation,
          screenWidth,
          screenHeight,
          timeSeconds: performance.now() / 1000,
        },
        drawScene,
      );
    },
    dispose(): void {
      pipeline.dispose();
      vao.dispose();
      vbo.dispose();
      ibo.dispose();
      texture.dispose();
      program.dispose();
    },
  };
}
