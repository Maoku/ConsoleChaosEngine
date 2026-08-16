import { describe, expect, it } from 'vitest';
import { GENERATION_IDS, HARDWARE_GENERATION_PROFILES } from '@console-chaos/engine';
import {
  SWAY_ANIMATION_PROFILES,
  pivotedSpriteCenter,
  swayAngle,
} from '../src/animation';

const degrees = (value: number): number => value * 180 / Math.PI;

describe('title sway animation', () => {
  it('uses only the declared FC/SFC step values and keeps each sample interval stable', () => {
    for (const generation of ['FC', 'SFC'] as const) {
      const hardware = HARDWARE_GENERATION_PROFILES[generation];
      const sampleHz = SWAY_ANIMATION_PROFILES[generation].sampleHz;
      const values = new Set<number>();
      for (let sample = 0; sample < sampleHz; sample += 1) {
        const start = sample / sampleHz;
        const atStart = swayAngle(hardware, start, false);
        const beforeNext = swayAngle(hardware, start + 0.999 / sampleHz, false);
        expect(beforeNext).toBeCloseTo(atStart, 12);
        values.add(Math.round(degrees(atStart)));
      }
      expect([...values].sort((left, right) => left - right)).toEqual([-5, 0, 5]);
    }
  });

  it('eases PS1/PS2 monotonically between exact shared endpoints', () => {
    for (const generation of ['PS1', 'PS2'] as const) {
      const hardware = HARDWARE_GENERATION_PROFILES[generation];
      expect(degrees(swayAngle(hardware, 0, false))).toBeCloseTo(-5, 12);
      expect(degrees(swayAngle(hardware, 0.5, false))).toBeCloseTo(5, 12);
      expect(degrees(swayAngle(hardware, 1, false))).toBeCloseTo(-5, 12);
      const samples = Array.from({ length: 16 }, (_, index) =>
        swayAngle(hardware, index / 30, false),
      );
      for (let index = 1; index < samples.length; index += 1) {
        expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1] ?? -Infinity);
      }
    }

    for (const time of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9]) {
      const ps1 = swayAngle(HARDWARE_GENERATION_PROFILES.PS1, time, false);
      const ps2 = swayAngle(HARDWARE_GENERATION_PROFILES.PS2, time, false);
      expect(ps1 * ps2).toBeGreaterThanOrEqual(-Number.EPSILON);
    }
  });

  it('keeps the rotated bottom-centre pivot fixed', () => {
    const pivot = [128, 224] as const;
    const size = [120, 144] as const;
    for (const angle of [-5, -2.5, 0, 2.5, 5].map((value) => value * Math.PI / 180)) {
      const center = pivotedSpriteCenter(pivot, size, angle);
      const bottomX = center[0] - Math.sin(angle) * size[1] / 2;
      const bottomY = center[1] + Math.cos(angle) * size[1] / 2;
      expect(bottomX).toBeCloseTo(pivot[0], 12);
      expect(bottomY).toBeCloseTo(pivot[1], 12);
    }
  });

  it('disables motion for every generation when reduced motion is requested', () => {
    for (const generation of GENERATION_IDS) {
      expect(swayAngle(HARDWARE_GENERATION_PROFILES[generation], 0.37, true)).toBe(0);
    }
  });
});
