import { describe, it, expect } from 'vitest';
import { FC_PALETTE, KEY_COLORS, fcColorOf, type KeyColorName } from '@/render/key_palette';
import { MASTER_PALETTE_RGB, nearestMasterIndex } from '@/render/quantize/master_palette';

/** `tools/texture_spec.ts` の QUANTIZE_LEVELS と同じ。第1世代が実際に見る明るさ */
const LEVELS = [1.0, 0.85, 0.7, 0.55, 0.45];

function luma([r, g, b]: readonly number[]): number {
  return 0.299 * r! + 0.587 * g! + 0.114 * b!;
}

/** 無彩色で、黒とも白とも呼べない明るさ（形が消える状態） */
function isMidGray(color: readonly number[]): boolean {
  const level = luma(color);
  return Math.max(...color) - Math.min(...color) < 26 && level >= 40 && level <= 200;
}

describe('render/key_palette（KV-01 色の基準表）', () => {
  it('基準画の 8 用途の色を持つ（§1.2）', () => {
    // 表そのものを固定する。基準画から取り直したときは、ここを直してから絵を作り直す
    expect(KEY_COLORS.titlePink).toEqual([0xf8, 0x58, 0x88]);
    expect(KEY_COLORS.red).toEqual([0xe8, 0x38, 0x48]);
    expect(KEY_COLORS.deepRed).toEqual([0x98, 0x08, 0x28]);
    expect(KEY_COLORS.cream).toEqual([0xf8, 0xe8, 0xd8]);
    expect(KEY_COLORS.sky).toEqual([0x18, 0x88, 0xe8]);
    expect(KEY_COLORS.stone).toEqual([0x58, 0x48, 0x68]);
    expect(KEY_COLORS.night).toEqual([0x08, 0x08, 0x28]);
    expect(KEY_COLORS.white).toEqual([0xf8, 0xf8, 0xf8]);
  });

  it('ステージの基準画の 8 用途の色を持つ（SG-02、上位計画 §1.1）', () => {
    // 題字の基準画（12 個）は**消さない**。`pipeline.ts` の切替の帯が読んでいる
    expect(KEY_COLORS.skyDay).toEqual([0x15, 0x74, 0xe5]);
    expect(KEY_COLORS.skyHorizon).toEqual([0x69, 0xc4, 0xfd]);
    expect(KEY_COLORS.grass).toEqual([0xb5, 0xbb, 0x27]);
    expect(KEY_COLORS.conifer).toEqual([0x1a, 0x49, 0x36]);
    expect(KEY_COLORS.sand).toEqual([0xf9, 0xc9, 0x76]);
    expect(KEY_COLORS.sandstone).toEqual([0x94, 0x6a, 0x47]);
    expect(KEY_COLORS.mesa).toEqual([0xe6, 0x98, 0x8a]);
    expect(KEY_COLORS.mesaFar).toEqual([0x78, 0x86, 0xaa]);
  });

  it('第1世代の 7 色が固定 54 色のどれに落ちるかを宣言している', () => {
    expect(FC_PALETTE).toHaveLength(7);
    for (const { key, index, source } of FC_PALETTE) {
      expect(nearestMasterIndex(source[0], source[1], source[2]), key).toBe(index);
      expect(MASTER_PALETTE_RGB[index], key).toBeDefined();
    }
  });

  it('7 色は互いに違う番号へ落ちる（同じ色が 2 つ並んでいない）', () => {
    const indices = FC_PALETTE.map((color) => color.index);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it('陰影を受けてよい色は、5 段すべてで中間灰へ落ちない', () => {
    for (const { key, source, lit } of FC_PALETTE) {
      if (!lit) continue;
      for (const level of LEVELS) {
        const landed = MASTER_PALETTE_RGB[
          nearestMasterIndex(source[0] * level, source[1] * level, source[2] * level)
        ]!;
        expect(isMidGray(landed), `${key} は明るさ ${level} で [${landed.join(',')}] へ落ちる`).toBe(false);
      }
    }
  });

  it('7 色が空のテーマの用途を持つ（SG-02 の判断 D）', () => {
    // **第1世代の絵はこの 7 つの名前だけで塗られる**（`tools/import-textures.ts` の写像表）。
    // 用途が 1 つ欠けると、その役割を担う色が最近傍へ逃げて形が消える（W-4）
    expect(FC_PALETTE.map((color) => color.key)).toEqual([
      'skyDay',
      'grass',
      'conifer',
      'sand',
      'sandstone',
      'mesa',
      'white',
    ]);
    // 陰影を受けられないのは白 1 つだけ。**背景専用の色は増えていない**（上位計画 SG-02 の条件）
    expect(FC_PALETTE.filter((color) => !color.lit).map((color) => color.key)).toEqual(['white']);
  });

  it('置いた色がそのまま出るとは限らない（道の砂色は黄色を置いて砂色として出る）', () => {
    // KV-01 と同じ事情。`source` を実測の #f9c976 にすると 54 色の低彩度の帯へ落ち、
    // 明るさ 0.7 で中間灰になる。**source と index を分けている理由がこれである**
    const sand = fcColorOf('sand');
    expect(sand.source).toEqual([0xf8, 0xd8, 0x60]);
    expect(MASTER_PALETTE_RGB[sand.index]).toEqual([228, 196, 144]);
  });

  it('背景専用の色（白）は、陰影を掛けると実際に中間灰へ落ちる', () => {
    // `lit: false` が「手心」ではなく実測であることの担保
    const white = fcColorOf('white');
    expect(white.lit).toBe(false);
    const dimmed = MASTER_PALETTE_RGB[
      nearestMasterIndex(white.source[0] * 0.7, white.source[1] * 0.7, white.source[2] * 0.7)
    ]!;
    expect(isMidGray(dimmed)).toBe(true);
  });

  it('表に無い色を第1世代で使おうとしたら落ちる', () => {
    expect(() => fcColorOf('sky' as KeyColorName)).toThrow(/第1世代の 7 色に無い/);
  });
});
