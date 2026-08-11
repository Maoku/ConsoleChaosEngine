import { describe, expect, it } from 'vitest';
import {
  FC_BLOCK_SIZE,
  MASTER_PALETTE_RGB,
  MASTER_PALETTE_SIZE,
  MASTER_PALETTE_UNIFORM,
  SFC_LEVELS,
  createFcQuantizePasses,
  createSfcQuantizePasses,
  nearestMasterIndex,
  quantizeChannel,
} from '@console-chaos/engine';

describe('generation render algorithmic goldens', () => {
  it('keeps the fixed 54-color table and deterministic nearest-color mapping', () => {
    expect(MASTER_PALETTE_RGB).toHaveLength(MASTER_PALETTE_SIZE);
    expect(MASTER_PALETTE_UNIFORM).toHaveLength(MASTER_PALETTE_SIZE * 3);
    for (const color of MASTER_PALETTE_RGB) {
      const chosen = MASTER_PALETTE_RGB[nearestMasterIndex(...color)]!;
      expect(chosen).toEqual(color);
    }
    expect(MASTER_PALETTE_RGB[nearestMasterIndex(0, 0, 0)]).toEqual([0, 0, 0]);
    expect(MASTER_PALETTE_RGB[nearestMasterIndex(255, 255, 255)]).toEqual([255, 255, 255]);
  });

  it('keeps fixed-palette quantization as a 16px block pass plus a full-size pass', () => {
    const texture = () => ({}) as never;
    const passes = createFcQuantizePasses({ width: 256, height: 224, scene: texture, sprites: texture });
    expect(FC_BLOCK_SIZE).toBe(16);
    expect(passes).toHaveLength(2);
    expect(passes[0]?.outputSize).toEqual({ width: 16, height: 28 });
    expect(passes[1]?.outputSize).toEqual({ width: 256, height: 224 });
  });

  it('keeps RGB555 at 32 exact channel levels', () => {
    expect(SFC_LEVELS).toBe(32);
    for (let index = 0; index < SFC_LEVELS; index++) {
      const value = index / (SFC_LEVELS - 1);
      expect(quantizeChannel(value)).toBeCloseTo(value, 6);
    }
    const [pass] = createSfcQuantizePasses({ width: 256, height: 224, sprites: () => ({}) as never });
    expect(pass?.outputSize).toEqual({ width: 256, height: 224 });
  });
});
