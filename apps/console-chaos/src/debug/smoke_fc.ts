/**
 * T0-10 の検証：FC のパレット量子化と 16×16 カラークラッシュ（候補 B）。
 *
 * 256×224 のテストシーンを描き、ブロックパレット（16×14）→ 量子化 の 2 パスを通して
 * 画面へ出す。量子化の強さと背景色、有効/無効を切り替えて比較できる。
 */
import {
  createFramebuffer,
  createProgram,
  createStateCache,
  createTexture,
  type Framebuffer,
  type GLContext,
  type StateCache,
  type Texture,
} from '@/render/gl/index';
import { createPostChain, type PostChain, type PostPassSpec } from '@/render/postfx/chain';
import { createCrtPasses } from '@/render/postfx/crt';
import type { CrtQuality } from '@/render/postfx/presets';
import { createFcQuantizePasses } from '@/render/quantize/palette_fc';
import type { SignalKind } from '@/generation/profiles';
import fullscreenVert from '@/render/shaders/fullscreen.vert.glsl?raw';
import commonGlsl from '@/render/shaders/common.glsl?raw';
import sceneSource from '@/render/shaders/test_scene_fc.glsl?raw';

const BLIT = 'void main() { fragColor = sampleSource(snapToTexel(vUv, uSourceSize)); }';

export interface FcParams {
  /** 0 = 素通し、1 = 完全なカラークラッシュ */
  amount: number;
  /** マスターパレットの番号。52 = 黒 */
  backgroundIndex: number;
  /** false にすると量子化パスを丸ごと飛ばす（比較用） */
  quantize: boolean;
  sceneTime: number;
  /** CRT の映像信号系統（世代プロファイルの値に相当） */
  signal: SignalKind;
  /** CRT の品質。off / light / full */
  crtQuality: CrtQuality;
}

export interface SmokeFc {
  readonly params: FcParams;
  draw(screenWidth: number, screenHeight: number): void;
  /** 量子化パスの実測用。描画のみを count 回繰り返す */
  drawSceneOnly(): void;
  dispose(): void;
}

export function createSmokeFc(ctx: GLContext, width = 256, height = 224): SmokeFc {
  const { gl } = ctx;
  const state: StateCache = createStateCache(ctx);
  const scene: Framebuffer = createFramebuffer(ctx, { width, height });
  const sceneProgram = createProgram(
    ctx,
    'test_scene_fc',
    fullscreenVert,
    `#version 300 es\n${commonGlsl}\n${sceneSource}`,
  );

  const params: FcParams = {
    amount: 1,
    backgroundIndex: 52,
    quantize: true,
    sceneTime: 0,
    signal: 'rf',
    crtQuality: 'full',
  };

  // ここはカラークラッシュ単体の検証なのでスプライトを持たない（T2-10）。
  // 面は全面 α = 0 の 1 枚を渡し、「何も描かれていない」状態を作る。
  // 1×1 では済まない：ブロックパス側が元解像度で texelFetch するため、寸法を合わせる
  const emptySprites: Texture = createTexture(ctx, { width, height });

  const quantizePasses: PostPassSpec[] = createFcQuantizePasses({
    width,
    height,
    scene: () => scene.color,
    sprites: () => emptySprites,
    backgroundIndex: () => params.backgroundIndex,
    amount: () => params.amount,
  }).map((pass) => ({ ...pass, enabled: () => params.quantize }));

  const crtPasses: PostPassSpec[] = createCrtPasses({
    signal: () => params.signal,
    quality: () => params.crtQuality,
    contentSize: () => ({ width, height }),
  });

  const chain: PostChain = createPostChain(ctx, state, [
    ...quantizePasses,
    ...crtPasses,
    { name: 'blit', fragmentSource: BLIT, enabled: () => params.crtQuality === 'off' },
  ]);

  function drawScene(): void {
    scene.bind();
    state.apply({ depthTest: false, depthWrite: false, blend: 'none', cull: 'none' });
    sceneProgram.use();
    sceneProgram.setUniforms({
      uSourceSize: [width, height],
      uOutputSize: [width, height],
      uSceneTime: params.sceneTime,
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    params,
    draw(screenWidth, screenHeight): void {
      drawScene();
      chain.run(scene.color, screenWidth, screenHeight);
    },
    drawSceneOnly: drawScene,
    dispose(): void {
      chain.dispose();
      sceneProgram.dispose();
      scene.dispose();
      emptySprites.dispose();
    },
  };
}
