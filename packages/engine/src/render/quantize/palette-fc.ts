/**
 * FC の量子化 + 16×16 ブロック割当（T0-10、GAME_PLAN §11.3、§5.4.6 の候補 B）。
 *
 * 2 パス構成：
 *   第 1 パス（16×28）BG 面とスプライト面のブロックごとに最頻 3 色を選び、
 *                     インデックスを RGB へ詰める（上段 BG / 下段スプライト）
 *   第 2 パス（256×224）各画素を自分の面のブロックパレットへ丸め、面を重ねる
 *
 * **面を分けるのは実機と同じ理由による**（T2-10）。BG は属性ブロックごとに色数が
 * 制限されるが、OBJ は自分のパレットを持ち、背景の色数に影響されない。
 * 混ぜて数えると、草の上に立ったキャラクタの靴が緑に潰れる。
 *
 * 1 パス方式（候補 A）は「全画素 × 256 テクセル走査」になるため先に B を実装し、
 * A の必要性は計測で判断する（§5.4.6 の指示どおりの順序）。
 */
import type { PostPassSpec } from '../postfx/chain';
import type { Texture } from '../gl/index';
import { MASTER_PALETTE_UNIFORM } from '../master-palette';
import blocksSource from '../shaders/quantize_fc_blocks';
import quantizeSource from '../shaders/quantize_fc';

/** 実機の属性ブロックと同じ 16×16 画素 */
export const FC_BLOCK_SIZE = 16;

export interface FcQuantizeOptions {
  /** 内部解像度（FC は 256×224） */
  width: number;
  height: number;
  /** 背景（BG 面）。第 2 パスがブロックパレットと併せて参照する */
  scene: () => Texture;
  /**
   * スプライト面（T2-10）。α = 0 の画素は「何も描かれていない」として扱い、
   * BG がそのまま出る。BG のブロックパレットにも一切影響しない
   */
  sprites: () => Texture;
  /** 画面共通の背景色（マスターパレットの番号）。既定は黒 */
  backgroundIndex?: () => number;
  /** 0 = 素通し、1 = 完全なカラークラッシュ。光過敏・色覚特性への配慮で弱められる */
  amount?: () => number;
}

/**
 * FC 量子化の 2 パスを、そのまま postfx チェーンへ差し込める形で返す。
 * チェーンの入力（uSource）は元画像であること。
 */
export function createFcQuantizePasses(options: FcQuantizeOptions): PostPassSpec[] {
  const blocksX = Math.ceil(options.width / FC_BLOCK_SIZE);
  const blocksY = Math.ceil(options.height / FC_BLOCK_SIZE);
  const sceneSize: [number, number] = [options.width, options.height];

  return [
    {
      name: 'fc_block_palette',
      fragmentSource: blocksSource,
      // BG 面とスプライト面のぶんを上下に積むので高さは 2 倍
      outputSize: { width: blocksX, height: blocksY * 2 },
      uniforms: () => ({
        uPalette: MASTER_PALETTE_UNIFORM,
        uSceneSize: sceneSize,
        uSprite: options.sprites(),
      }),
    },
    {
      name: 'fc_quantize',
      fragmentSource: quantizeSource,
      outputSize: { width: options.width, height: options.height },
      uniforms: () => ({
        uPalette: MASTER_PALETTE_UNIFORM,
        uScene: options.scene(),
        uSprite: options.sprites(),
        uSceneSize: sceneSize,
        uBackgroundIndex: options.backgroundIndex?.() ?? 52,
        uAmount: options.amount?.() ?? 1,
      }),
    },
  ];
}
