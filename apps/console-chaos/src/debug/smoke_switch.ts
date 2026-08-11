/**
 * T0-12（V7）の検証：世代切替のパイプライン差し替え。
 *
 * 同じシーンを 4 世代の経路で描き、切替中は 2 世代を描いてブレンドする。
 * シーン側は「プロファイルに従って描く」だけで、世代 ID を見ない
 * （不変条件 I2 / I5：切替はシミュレーションの真実を変えない）。
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
import { createSwitcher, type Switcher } from '@/generation/switcher';
import { TRANSITION_DURATION_MS } from '@/generation/transition';
import ps1Vertex from '@/render/shaders/ps1_vertex.glsl?raw';
import ps1Fragment from '@/render/shaders/ps1_forward.glsl?raw';

/** 切替の所要時間（GAME_PLAN §5.1）。強制切替は 600ms（T3-02） */
export const SWITCH_DURATION_MS = TRANSITION_DURATION_MS.player;

export interface SwitchParams {
  generation: GenerationId;
  crtQuality: CrtQuality;
  time: number;
}

export interface SmokeSwitch {
  readonly params: SwitchParams;
  readonly pipeline: Pipeline;
  /** 世代を切り替える。トランジションが始まる */
  switchTo(generation: GenerationId): void;
  /** 次の世代へ循環（デバッグ用） */
  cycle(): void;
  advance(seconds: number): void;
  draw(screenWidth: number, screenHeight: number): void;
  readonly transitioning: boolean;
  dispose(): void;
}

function checkerTexture(ctx: GLContext, size = 64): Texture {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dark = ((x >> 3) + (y >> 3)) % 2 === 0;
      const i = (y * size + x) * 4;
      pixels[i] = dark ? 40 : 225;
      pixels[i + 1] = dark ? 70 : 195;
      pixels[i + 2] = dark ? 110 : 150;
      pixels[i + 3] = 255;
    }
  }
  return createTexture(ctx, { width: size, height: size, filter: 'nearest', wrap: 'repeat', data: pixels });
}

export function createSmokeSwitch(ctx: GLContext): SmokeSwitch {
  const { gl } = ctx;

  // 床 + 縦のパネル。2D 投影と 3D 投影で見え方が変わる題材
  const vertices = new Float32Array([
    -4, 0, 4, 0, 1, 0, 0, 0,
    4, 0, 4, 0, 1, 0, 4, 0,
    -4, 0, -20, 0, 1, 0, 0, 10,
    4, 0, -20, 0, 1, 0, 4, 10,
    -2, 0, -6, 0, 0, 1, 0, 0,
    2, 0, -6, 0, 0, 1, 2, 0,
    -2, 3, -6, 0, 0, 1, 0, 2,
    2, 3, -6, 0, 0, 1, 2, 2,
  ]);
  const indices = new Uint16Array([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
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

  const program = createProgram(ctx, 'scene_forward', ps1Vertex, ps1Fragment);
  const state: StateCache = createStateCache(ctx);
  const texture = checkerTexture(ctx);
  const camera: Camera = createCamera('perspective');
  const model = mat4.create();

  const params: SwitchParams = { generation: 'FC', crtQuality: 'full', time: 0 };
  // 切替の状態管理は T1-03 の switcher に任せる（このシーンは描画の確認だけを担う）
  const switcher: Switcher = createSwitcher({ initial: params.generation });

  const pipeline: Pipeline = createPipeline(ctx, {
    quality: () => params.crtQuality,
    glitchAmount: () => 1,
  });

  /** プロファイルの値だけを見てシーンを描く。世代 ID は参照しない */
  function drawScene(profile: GenerationProfile): void {
    const video = profile.video;
    camera.projection = video.projection === 'ortho2d' ? 'ortho' : 'perspective';
    camera.position[0] = 0;
    camera.position[1] = video.projection === 'ortho2d' ? 1.5 : 2.2;
    camera.position[2] = 7;
    camera.target[0] = 0;
    camera.target[1] = 1.2;
    camera.target[2] = -6;
    camera.update(video.internalWidth / video.internalHeight);

    texture.setFilter(video.textureFilter);
    state.apply({
      depthTest: video.depthBuffer,
      depthWrite: video.depthBuffer,
      blend: 'none',
      cull: 'none',
    });
    program.use();
    program.setUniforms({
      uModel: model as Float32Array,
      uViewProjection: camera.viewProjection as Float32Array,
      uResolution: [video.internalWidth, video.internalHeight],
      uQuantizeStep: video.vertexQuantize,
      uAffineAmount: video.affineTexture ? 1 : 0,
      uBaseColor: texture,
      uBaseColorFactor: [1, 1, 1, 1],
      uLightDirection: [0.4, 1, 0.6],
      // 陰影の既定値（T2-04 でシェーダの固定値を uniform にした）。検証シーンは松明を持たない
      uAmbient: DEFAULT_AMBIENT,
      uDiffuse: DEFAULT_DIFFUSE,
    });
    vao.bind();
    gl.drawElements(gl.TRIANGLES, indices.length, vao.indexType, 0);
  }

  return {
    params,
    pipeline,
    get transitioning() {
      return switcher.transition.active;
    },
    switchTo(generation): void {
      switcher.request(generation);
      params.generation = switcher.generation;
    },
    cycle(): void {
      switcher.cycle(1);
      params.generation = switcher.generation;
    },
    advance(seconds): void {
      params.time += seconds;
      switcher.advance(seconds * 1000);
      params.generation = switcher.generation;
    },
    draw(screenWidth, screenHeight): void {
      pipeline.render(
        {
          generation: switcher.generation,
          from: switcher.renderFrom,
          blend: switcher.blend,
          screenWidth,
          screenHeight,
          timeSeconds: params.time,
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
