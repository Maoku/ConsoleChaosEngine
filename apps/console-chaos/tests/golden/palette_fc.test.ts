import { describe, it, expect } from 'vitest';
import {
  MASTER_PALETTE_RGB,
  MASTER_PALETTE_SIZE,
  MASTER_PALETTE_UNIFORM,
  nearestMasterIndex,
} from '@/render/quantize/master_palette';
import { FC_BLOCK_SIZE, createFcQuantizePasses } from '@/render/quantize/palette_fc';

describe('FC マスターパレット', () => {
  it('54 色ちょうど持つ', () => {
    expect(MASTER_PALETTE_RGB).toHaveLength(MASTER_PALETTE_SIZE);
    expect(MASTER_PALETTE_UNIFORM).toHaveLength(MASTER_PALETTE_SIZE * 3);
  });

  it('uniform 配列は 0..1 に正規化されている', () => {
    for (const v of MASTER_PALETTE_UNIFORM) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('パレット内の色は自分自身に量子化される（ゴールデン）', () => {
    MASTER_PALETTE_RGB.forEach((color) => {
      const index = nearestMasterIndex(color[0], color[1], color[2]);
      const chosen = MASTER_PALETTE_RGB[index]!;
      // 完全な重複色（明度 3 と 4 の白）があるため、色の一致で確認する
      expect([chosen[0], chosen[1], chosen[2]]).toEqual([color[0], color[1], color[2]]);
      expect(index).toBeLessThan(MASTER_PALETTE_SIZE);
    });
  });

  it('黒と白は専用の背景色に落ちる', () => {
    expect(MASTER_PALETTE_RGB[nearestMasterIndex(0, 0, 0)]).toEqual([0, 0, 0]);
    expect(MASTER_PALETTE_RGB[nearestMasterIndex(255, 255, 255)]).toEqual([255, 255, 255]);
  });

  it('同じ入力なら常に同じ番号（決定的：不変条件 I4）', () => {
    for (const rgb of [
      [200, 30, 40],
      [12, 200, 90],
      [128, 128, 128],
    ] as const) {
      const first = nearestMasterIndex(rgb[0], rgb[1], rgb[2]);
      expect(nearestMasterIndex(rgb[0], rgb[1], rgb[2])).toBe(first);
    }
  });
});

describe('FC カラークラッシュのパス構成（候補 B）', () => {
  const stub = () => ({}) as never;

  it('2 パスで、第 1 パスがブロック解像度、第 2 パスが元解像度', () => {
    const passes = createFcQuantizePasses({
      width: 256,
      height: 224,
      scene: stub,
      sprites: stub,
    });
    expect(passes).toHaveLength(2);
    // ブロックは 16×14。BG 面とスプライト面のぶんを上下に積むので高さは 2 倍（T2-10）
    expect(passes[0]?.outputSize).toEqual({ width: 16, height: 28 });
    expect(passes[1]?.outputSize).toEqual({ width: 256, height: 224 });
  });

  it('ブロックサイズは実機の属性ブロックと同じ 16 画素', () => {
    expect(FC_BLOCK_SIZE).toBe(16);
  });

  it('端数のある解像度でもブロック数を切り上げる', () => {
    const passes = createFcQuantizePasses({ width: 250, height: 220, scene: stub, sprites: stub });
    expect(passes[0]?.outputSize).toEqual({ width: 16, height: 28 });
  });

  it('両方のパスがスプライト面を受け取る（BG と色を取り合わせない。T2-10）', () => {
    const plane = { id: 'sprites' } as never;
    const passes = createFcQuantizePasses({
      width: 256,
      height: 224,
      scene: stub,
      sprites: () => plane,
    });
    // 第 1 パス: スプライト面のブロックパレットを BG と別に数えるため
    // 第 2 パス: 面を重ね、画素ごとにどちらのパレットで丸めるか決めるため
    for (const pass of passes) {
      expect(pass.uniforms?.().uSprite, pass.name).toBe(plane);
    }
  });
});
