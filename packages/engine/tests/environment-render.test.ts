import { describe, expect, it } from 'vitest';
import { reflectionUv } from '../src/render/environment/mapping';
import { FALLBACK_LIGHT_DIRECTION, resolveFrameLighting } from '../src/render/lighting';

describe('frame lighting and environment contracts', () => {
  it('keeps the legacy light fallback when no commands are supplied', () => {
    expect(resolveFrameLighting([], 'PS2', true, [0.8, 0.9, 1])).toEqual({
      ambient: [0.8, 0.9, 1],
      directionalDirection: FALLBACK_LIGHT_DIRECTION,
      directionalColor: [1, 1, 1],
      point: [0, 0, 0, 0],
      pointColor: [1, 1, 1],
    });
  });

  it('resolves generation-masked ambient/directional light and the strongest point light', () => {
    const lights = [
      { id: 'ambient', kind: 'ambient' as const, position: [0, 0, 0] as const, color: '#804020', intensity: 0.5, radius: 0, generations: ['PS2'] as const },
      { id: 'sun', kind: 'directional' as const, position: [0, 0, 0] as const, direction: [-1, 2, 0] as const, color: '#80c0ff', intensity: 0.75, radius: 0, generations: ['PS2'] as const },
      { id: 'weak', kind: 'point' as const, position: [1, 2, 3] as const, color: '#ffffff', intensity: 0.25, radius: 4, generations: ['PS2'] as const },
      { id: 'strong', kind: 'point' as const, position: [3, 4, 5] as const, color: '#ff8000', intensity: 0.8, radius: 6, generations: ['PS2'] as const },
    ];
    const resolved = resolveFrameLighting(lights, 'PS2', true, [1, 1, 1]);
    expect(resolved.ambient).toEqual([128 / 255 * 0.5, 64 / 255 * 0.5, 32 / 255 * 0.5]);
    expect(resolved.directionalDirection).toEqual([-1, 2, 0]);
    expect(resolved.directionalColor).toEqual([128 / 255 * 0.75, 192 / 255 * 0.75, 0.75]);
    expect(resolved.point).toEqual([3, 4, 5, 6]);
    expect(resolved.pointColor).toEqual([0.8, 128 / 255 * 0.8, 0]);
    expect(resolveFrameLighting(lights, 'PS1', false, [1, 1, 1]).point[3]).toBe(0);
  });

  it('moves reflection lookup continuously with the camera', () => {
    const first = reflectionUv([0, 0, 0], [0, 1, 0], [0, 1, 1]);
    const second = reflectionUv([0, 0, 0], [0, 1, 0], [0.01, 1, 1]);
    expect(Math.abs(second[0] - first[0])).toBeLessThan(0.01);
    expect(Math.abs(second[1] - first[1])).toBeLessThan(0.01);
  });
});
