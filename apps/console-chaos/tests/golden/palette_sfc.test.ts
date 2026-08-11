import { describe, it, expect } from 'vitest';
import { SFC_LEVELS, createSfcQuantizePasses, quantizeChannel } from '@/render/quantize/palette_sfc';
import { createFcQuantizePasses } from '@/render/quantize/palette_fc';

describe('SFC RGB555 量子化', () => {
  it('チャンネルあたり 32 段階', () => {
    expect(SFC_LEVELS).toBe(32);
  });

  it('段階の値はそのまま保たれる（ゴールデン）', () => {
    for (let i = 0; i < SFC_LEVELS; i++) {
      const value = i / (SFC_LEVELS - 1);
      expect(quantizeChannel(value)).toBeCloseTo(value, 6);
    }
  });

  it('中間色は最も近い段階へ丸められる', () => {
    const step = 1 / (SFC_LEVELS - 1);
    expect(quantizeChannel(step * 0.4)).toBeCloseTo(0, 6);
    expect(quantizeChannel(step * 0.6)).toBeCloseTo(step, 6);
  });

  it('0 と 1 は保たれる（黒と白が転ばない）', () => {
    expect(quantizeChannel(0)).toBe(0);
    expect(quantizeChannel(1)).toBe(1);
  });

  it('FC と同じ PostPassSpec[] の形で返る（同じパス列に乗る）', () => {
    const stub = () => ({}) as never;
    const sfc = createSfcQuantizePasses({ width: 256, height: 224, sprites: stub });
    const fc = createFcQuantizePasses({ width: 256, height: 224, scene: stub, sprites: stub });

    expect(sfc).toHaveLength(1);
    expect(fc).toHaveLength(2);
    for (const pass of [...sfc, ...fc]) {
      expect(typeof pass.name).toBe('string');
      expect(typeof pass.fragmentSource).toBe('string');
      expect(typeof pass.uniforms).toBe('function');
    }
    // 出力解像度は両世代とも内部解像度
    expect(sfc[0]?.outputSize).toEqual({ width: 256, height: 224 });
    expect(fc[1]?.outputSize).toEqual({ width: 256, height: 224 });
  });

  it('スプライト面を uniform として受け取る（T2-11）', () => {
    // 第2世代のプレイヤーは絵で、背景とは別の面へ描かれる（pipeline.ts の SpriteDrawer）。
    // ここで受け取らないと、面は毎フレーム描かれるのに画面には出ない
    const plane = { plane: true } as never;
    const [pass] = createSfcQuantizePasses({ width: 256, height: 224, sprites: () => plane });
    expect(pass?.uniforms?.().uSprite).toBe(plane);
  });
});
