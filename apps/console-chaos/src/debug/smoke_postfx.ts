/**
 * T0-05 の受け入れ確認：2 パス以上のフルスクリーンパス列と中間 FBO の受け渡し。
 *
 * 三角形を内部解像度の FBO に描き、
 *   パス1（低解像度への縮約 + 色相の入れ替え）→ パス2（走査線を模した縞）→ 画面
 * の順で処理する。ゲーム本体の経路（render/pipeline.ts）とは無関係の足場。
 */
import {
  createFramebuffer,
  createStateCache,
  type Framebuffer,
  type GLContext,
  type StateCache,
} from '@/render/gl/index';
import { createPostChain, type PostChain } from '@/render/postfx/chain';

const SWAP_CHANNELS = `
void main() {
  vec3 c = sampleSource(snapToTexel(vUv, uSourceSize)).rgb;
  fragColor = vec4(c.b, c.r, c.g, 1.0);
}
`;

const SCANLINES = `
void main() {
  vec3 c = sampleSource(vUv).rgb;
  float line = mod(floor(vUv.y * uSourceSize.y), 2.0);
  fragColor = vec4(c * mix(1.0, 0.55, line), 1.0);
}
`;

export interface SmokePostFX {
  draw(screenWidth: number, screenHeight: number): void;
  readonly passCount: number;
  /** 内部解像度の縦横比（シーン描画側が投影に使う） */
  readonly aspect: number;
  dispose(): void;
}

/**
 * @param drawScene 内部解像度の FBO へシーンを描く。パス列の入力になる
 */
export function createSmokePostFX(
  ctx: GLContext,
  drawScene: () => void,
  internalWidth = 320,
  internalHeight = 240,
): SmokePostFX {
  const state: StateCache = createStateCache(ctx);
  const scene: Framebuffer = createFramebuffer(ctx, {
    width: internalWidth,
    height: internalHeight,
    depth: true,
  });
  const chain: PostChain = createPostChain(ctx, state, [
    { name: 'swap_channels', fragmentSource: SWAP_CHANNELS },
    { name: 'scanlines', fragmentSource: SCANLINES },
  ]);

  return {
    aspect: internalWidth / internalHeight,
    draw(screenWidth, screenHeight): void {
      scene.bind();
      drawScene();
      chain.run(scene.color, screenWidth, screenHeight);
    },
    get passCount() {
      return chain.lastPassCount;
    },
    dispose(): void {
      chain.dispose();
      scene.dispose();
    },
  };
}
