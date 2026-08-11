import { describe, expect, it } from 'vitest';
import { affineUvAt } from '../src/render/affine/reference';
import { equirectangularUv, reflectDirection, reflectionUv } from '../src/render/environment/mapping';

describe('Racing renewal math spikes', () => {
  it('matches the affine CPU reference at corners and center samples', () => {
    const transform = {
      uvOrigin: [0.125, 0.25] as const,
      uvStepX: [0.25, 0.125] as const,
      uvStepY: [-0.125, 0.5] as const,
    };

    expect(affineUvAt(transform, [0, 0], 'clamp')).toEqual([0.125, 0.25]);
    expect(affineUvAt(transform, [1, 0], 'clamp')).toEqual([0.375, 0.375]);
    expect(affineUvAt(transform, [0, 1], 'clamp')).toEqual([0, 0.75]);
    expect(affineUvAt(transform, [0.5, 0.5], 'clamp')).toEqual([0.1875, 0.5625]);
    expect(affineUvAt(transform, [4, 2], 'repeat')).toEqual([0.875, 0.75]);
  });

  it('maps cardinal directions to deterministic equirectangular UVs', () => {
    expect(equirectangularUv([1, 0, 0])).toEqual([0.5, 0.5]);
    expect(equirectangularUv([0, 0, 1])).toEqual([0.75, 0.5]);
    expect(equirectangularUv([-1, 0, 0])).toEqual([0, 0.5]);
    expect(equirectangularUv([0, 1, 0])).toEqual([0.5, 0]);
    expect(equirectangularUv([0, -1, 0])).toEqual([0.5, 1]);
  });

  it('reflects the camera ray before environment lookup', () => {
    expect(reflectDirection([0, 0, -1], [0, 0, 1])).toEqual([0, 0, 1]);
    expect(reflectionUv([0, 0, 0], [0, 0, 1], [0, 0, 1])).toEqual([0.75, 0.5]);
  });
});
