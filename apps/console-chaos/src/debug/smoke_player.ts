/**
 * T0-06 / T0-19：Blender から書き出した実アセットを、ゲームと同じ経路で 4 世代表示する。
 *
 * - `tools/blender_export_player.py` の出力（`player.gltf`）をローダで読む
 * - スキニングとボーンアニメを再生する（idle / walk / jump を名前で選ぶ）
 * - **アニメーションの再生レートは世代プロファイルの `animationHz` で量子化する**
 *   （第1世代は 6fps にコマ落ちする。アセット側にコマ落ちを作らないという
 *     asset-rules.md §6 の規則が、ここで実際に効いていることの確認）
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
import {
  computeGlobalMatrices,
  computeJointMatrices,
  createPose,
  loadGltf,
  sampleAnimation,
  type GltfModel,
  type GltfPrimitive,
} from '@/render/loader/gltf';
import skinnedVertex from '@/render/shaders/skinned_test.vert.glsl?raw';
import ps1Fragment from '@/render/shaders/ps1_forward.glsl?raw';

export interface PlayerParams {
  generation: GenerationId;
  crtQuality: CrtQuality;
  /** アニメーションの時刻（秒）。世代ごとの量子化は描画側で行う */
  animationSeconds: number;
  yaw: number;
  /** 再生するアニメーション名（idle / walk / jump） */
  clip: string;
  /**
   * 2D 投影時の表示高さ（ワールド単位）。
   *
   * ここを内部解像度 / PIXELS_PER_WORLD_UNIT（第1世代なら 224/32 = 7）に合わせると、
   * 1 ワールド単位がちょうど 32 画素になり、モデルの 0.25 単位グリッドが
   * 第1世代の 8 画素タイル・16 画素カラーブロックと一致する（T1-08 の確認対象）。
   * 既定はモデルを大きく見るための寄り（2.6）。
   */
  orthoHeight: number;
  /**
   * 横位置（ワールド単位）。カラークラッシュのブロック境界に対してキャラを
   * ずらし、「移動中に色が明滅しないか」を測るために使う（T0-19 の申し送り 5）
   */
  offsetX: number;
}

export interface SmokePlayer {
  readonly params: PlayerParams;
  readonly triangleCount: number;
  /** モデルが持つアニメーション名（登録順） */
  readonly clips: string[];
  /** 次のアニメーションへ切り替える（デバッグ用） */
  cycleClip(): void;
  advance(seconds: number): void;
  draw(screenWidth: number, screenHeight: number): void;
  dispose(): void;
}

interface DrawablePrimitive {
  vao: VertexArray;
  count: number;
  color: [number, number, number, number];
}

export async function createSmokePlayer(ctx: GLContext, url: string): Promise<SmokePlayer> {
  const { gl } = ctx;
  const model: GltfModel = await loadGltf(url);
  const buffers: Array<{ dispose(): void }> = [];

  function buildPrimitive(primitive: GltfPrimitive): DrawablePrimitive {
    const vertexCount = primitive.positions.length / 3;
    const position = createBuffer(ctx, 'vertex', primitive.positions);
    const normal = createBuffer(ctx, 'vertex', primitive.normals ?? new Float32Array(vertexCount * 3));
    const uv = createBuffer(ctx, 'vertex', primitive.uvs ?? new Float32Array(vertexCount * 2));
    // JOINTS_0 は整数だが、属性としては float で渡す（実装を単純に保つ）
    const joints = createBuffer(
      ctx,
      'vertex',
      new Float32Array(primitive.joints ?? new Uint16Array(vertexCount * 4)),
    );
    const weights = createBuffer(ctx, 'vertex', primitive.weights ?? new Float32Array(vertexCount * 4));
    const indices = createBuffer(ctx, 'index', primitive.indices);
    buffers.push(position, normal, uv, joints, weights, indices);

    const vao = createVertexArray(
      ctx,
      [
        { location: 0, size: 3, buffer: position },
        { location: 1, size: 3, buffer: normal },
        { location: 2, size: 2, buffer: uv },
        { location: 3, size: 4, buffer: joints },
        { location: 4, size: 4, buffer: weights },
      ],
      { buffer: indices, type: primitive.indices instanceof Uint32Array ? 'uint' : 'ushort' },
    );
    const material = primitive.material === null ? null : model.materials[primitive.material];
    return {
      vao,
      count: primitive.indices.length,
      color: (material?.baseColorFactor ?? [1, 1, 1, 1]) as [number, number, number, number],
    };
  }

  const primitives: DrawablePrimitive[] = model.meshes.flatMap((mesh) =>
    mesh.primitives.map(buildPrimitive),
  );

  const program = createProgram(ctx, 'player', skinnedVertex, ps1Fragment);
  const texture: Texture = createTexture(ctx, {
    width: 2,
    height: 2,
    filter: 'nearest',
    data: new Uint8Array([255, 255, 255, 255, 238, 238, 238, 255, 238, 238, 238, 255, 255, 255, 255, 255]),
  });
  const state: StateCache = createStateCache(ctx);
  const camera: Camera = createCamera('perspective');
  const modelMatrix = mat4.create();

  // 毎フレームのアロケーションを避けるため事前確保する
  const pose = createPose(model);
  const globals = new Float32Array(model.nodes.length * 16);
  const jointCount = model.skins[0]?.joints.length ?? 1;
  const jointMatrices = new Float32Array(Math.max(jointCount, 1) * 16);
  const clips = model.animations.map((a, index) => a.name || `anim${index}`);

  const params: PlayerParams = {
    generation: 'FC',
    crtQuality: 'full',
    animationSeconds: 0,
    yaw: 0.5,
    clip: clips[0] ?? '',
    orthoHeight: 2.6,
    offsetX: 0,
  };

  /** 名前でアニメーションを引く。無ければ先頭 */
  function currentAnimation() {
    const index = clips.indexOf(params.clip);
    return model.animations[index >= 0 ? index : 0];
  }
  const pipeline: Pipeline = createPipeline(ctx, { quality: () => params.crtQuality });

  function drawScene(profile: GenerationProfile): void {
    const video = profile.video;

    // 世代ごとのコマ落ち：再生時刻そのものを量子化する（アセットは常に滑らか）
    const step = 1 / video.animationHz;
    const quantizedTime = Math.floor(params.animationSeconds / step) * step;
    const animation = currentAnimation();
    if (animation) sampleAnimation(animation, quantizedTime, pose);
    computeGlobalMatrices(model, pose, globals);
    if (model.skins.length > 0) computeJointMatrices(model, 0, globals, jointMatrices);

    camera.projection = video.projection === 'ortho2d' ? 'ortho' : 'perspective';
    camera.orthoHeight = params.orthoHeight;
    // 寄り／実寸のどちらでもキャラが画面に収まるよう、注視点を身長の中程に置く
    const eyeHeight = 1.0;
    camera.position[0] = 0;
    camera.position[1] = eyeHeight;
    camera.position[2] = 3.2;
    camera.target[0] = 0;
    camera.target[1] = eyeHeight;
    camera.target[2] = 0;
    camera.update(video.internalWidth / video.internalHeight);

    mat4.identity(modelMatrix);
    mat4.translate(modelMatrix, modelMatrix, [params.offsetX, 0, 0]);
    mat4.rotateY(modelMatrix, modelMatrix, params.yaw);

    texture.setFilter(video.textureFilter);
    state.apply({
      depthTest: video.depthBuffer,
      depthWrite: video.depthBuffer,
      blend: 'none',
      cull: 'back',
    });
    state.clear(0.16, 0.2, 0.34, 1, video.depthBuffer);
    program.use();

    for (const primitive of primitives) {
      program.setUniforms({
        uJoints: jointMatrices,
        uModel: modelMatrix as Float32Array,
        uViewProjection: camera.viewProjection as Float32Array,
        uResolution: [video.internalWidth, video.internalHeight],
        uQuantizeStep: video.vertexQuantize,
        uAffineAmount: video.affineTexture ? 1 : 0,
        uBaseColor: texture,
        uBaseColorFactor: primitive.color,
        uLightDirection: [0.35, 0.9, 0.7],
        // 陰影の既定値（T2-04 でシェーダの固定値を uniform にした）。検証シーンは松明を持たない
        uAmbient: DEFAULT_AMBIENT,
        uDiffuse: DEFAULT_DIFFUSE,
      });
      primitive.vao.bind();
      gl.drawElements(gl.TRIANGLES, primitive.count, primitive.vao.indexType, 0);
    }
  }

  return {
    params,
    clips,
    triangleCount: primitives.reduce((sum, p) => sum + p.count / 3, 0),
    cycleClip(): void {
      if (clips.length === 0) return;
      const next = (clips.indexOf(params.clip) + 1) % clips.length;
      params.clip = clips[next]!;
      params.animationSeconds = 0;
    },
    advance(seconds): void {
      params.animationSeconds += seconds;
    },
    draw(screenWidth, screenHeight): void {
      pipeline.render(
        {
          generation: params.generation,
          screenWidth,
          screenHeight,
          timeSeconds: params.animationSeconds,
        },
        drawScene,
      );
    },
    dispose(): void {
      pipeline.dispose();
      for (const primitive of primitives) primitive.vao.dispose();
      for (const buffer of buffers) buffer.dispose();
      texture.dispose();
      program.dispose();
    },
  };
}
