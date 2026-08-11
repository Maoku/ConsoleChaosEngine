/**
 * SFC の RGB555 量子化（T0-13。T2-11 でスプライト面の合成を追加）。
 *
 * FC（palette_fc.ts）と同じパス列の上に乗ることを確認するのが本タスクの目的。
 * FC が 2 パス（ブロックパレット → 量子化）なのに対し、SFC は 1 パスで済む。
 * どちらも同じ `PostPassSpec[]` を返すため、pipeline.ts 側は差を意識しない。
 *
 * **スプライト面の合成もここで行う**（T2-11）。プレイヤーを絵で描く世代は
 * 背景と別の面へ描かれる（`pipeline.ts` の `SpriteDrawer`）ので、
 * どこかで重ねないと絵が画面に出ない。FC と違い色数の取り合いは無いため、
 * ここでは重ねるだけで、パレットの選び直しはしない。
 */
import type { PostPassSpec } from '../postfx/chain';
import type { Texture } from '../gl/index';
import quantizeSource from '../shaders/quantize_sfc';

/** チャンネルあたりのビット数（RGB555） */
export const SFC_CHANNEL_BITS = 5;
export const SFC_LEVELS = 1 << SFC_CHANNEL_BITS; // 32

export interface SfcQuantizeOptions {
  width: number;
  height: number;
  /**
   * スプライト面（T2-11）。α = 0 の画素は「何も描かれていない」として扱い、
   * 背景がそのまま出る。FC と違い、面ごとに色数を分ける必要は無い
   *（第2世代の色は画面全体で RGB555。ブロック単位の制限を持たない）
   */
  sprites: () => Texture;
  /** 0 = 素通し、1 = 完全な量子化 */
  amount?: () => number;
}

export function createSfcQuantizePasses(options: SfcQuantizeOptions): PostPassSpec[] {
  return [
    {
      name: 'sfc_quantize',
      fragmentSource: quantizeSource,
      outputSize: { width: options.width, height: options.height },
      uniforms: () => ({
        uLevels: SFC_LEVELS,
        uAmount: options.amount?.() ?? 1,
        uSprite: options.sprites(),
      }),
    },
  ];
}

/** CPU 側でも同じ量子化ができるようにしておく（ゴールデンテスト用） */
export function quantizeChannel(value01: number, levels = SFC_LEVELS): number {
  const steps = Math.max(levels - 1, 1);
  return Math.round(value01 * steps) / steps;
}
