import { describe, expect, it } from 'vitest';
import { GENERATION_IDS, HARDWARE_GENERATION_PROFILES } from '@console-chaos/engine';
import {
  SWAY_ANIMATION_PROFILES,
  pivotedSpriteCenter,
  titleAnimationFrame,
} from '../src/animation';

const degrees = (value: number): number => value * 180 / Math.PI;

describe('title character animation', () => {
  it('uses profile animation rates and asset-only body poses for FC/SFC', () => {
    for (const generation of ['FC', 'SFC'] as const) {
      const hardware = HARDWARE_GENERATION_PROFILES[generation];
      const sampleHz = SWAY_ANIMATION_PROFILES[generation].sampleHz;
      expect(sampleHz).toBe(hardware.video.animationHz);
      const poses = new Set<string>();
      for (let sample = 0; sample < sampleHz; sample += 1) {
        const start = sample / sampleHz;
        const atStart = titleAnimationFrame(hardware, start, false);
        const beforeNext = titleAnimationFrame(hardware, start + 0.999 / sampleHz, false);
        expect(atStart.angle).toBe(0);
        expect(beforeNext).toEqual(atStart);
        poses.add(atStart.pose);
      }
      expect([...poses].sort()).toEqual(['center', 'left', 'right']);
    }
  });

  it('eases PS1/PS2 monotonically between exact shared endpoints', () => {
    for (const generation of ['PS1', 'PS2'] as const) {
      const hardware = HARDWARE_GENERATION_PROFILES[generation];
      expect(SWAY_ANIMATION_PROFILES[generation].sampleHz).toBe(hardware.video.animationHz);
      expect(degrees(titleAnimationFrame(hardware, 0, false).angle)).toBeCloseTo(-5, 12);
      expect(degrees(titleAnimationFrame(hardware, 0.5, false).angle)).toBeCloseTo(5, 12);
      expect(degrees(titleAnimationFrame(hardware, 1, false).angle)).toBeCloseTo(-5, 12);
      const samples = Array.from({ length: 16 }, (_, index) =>
        titleAnimationFrame(hardware, index / 30, false).angle,
      );
      for (let index = 1; index < samples.length; index += 1) {
        expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1] ?? -Infinity);
      }
    }

    for (const time of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9]) {
      const ps1 = titleAnimationFrame(HARDWARE_GENERATION_PROFILES.PS1, time, false).angle;
      const ps2 = titleAnimationFrame(HARDWARE_GENERATION_PROFILES.PS2, time, false).angle;
      expect(ps1 * ps2).toBeGreaterThanOrEqual(-Number.EPSILON);
    }
  });

  it('samples a three-second generation-aware blink sequence', () => {
    for (const generation of GENERATION_IDS) {
      const hardware = HARDWARE_GENERATION_PROFILES[generation];
      const sampleHz = SWAY_ANIMATION_PROFILES[generation].sampleHz;
      const eyes = new Set(
        Array.from({ length: sampleHz * 3 }, (_, sample) =>
          titleAnimationFrame(hardware, sample / sampleHz, false).eyes,
        ),
      );
      expect(eyes.has('open')).toBe(true);
      expect(eyes.has('closed')).toBe(true);
      expect(eyes.has('half')).toBe(generation !== 'FC');
      expect(titleAnimationFrame(hardware, 0, false).eyes).toBe('open');
      expect(titleAnimationFrame(hardware, 3, false).eyes).toBe('open');
    }
  });

  it('selects ponytail texture poses behind the continuous PS1/PS2 body motion', () => {
    for (const generation of ['PS1', 'PS2'] as const) {
      const hardware = HARDWARE_GENERATION_PROFILES[generation];
      const states = Array.from({ length: hardware.video.animationHz }, (_, sample) =>
        titleAnimationFrame(hardware, sample / hardware.video.animationHz, false),
      );
      expect(new Set(states.map((state) => state.pose))).toEqual(new Set(['left', 'center', 'right']));
      expect(states[0]?.pose).toBe('left');
      expect(states[1]?.pose).toBe('left');
      expect(states.some((state) => state.pose === 'center' && state.angle !== 0)).toBe(true);
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

  it('freezes body and ponytail motion but preserves blinking for reduced motion', () => {
    for (const generation of GENERATION_IDS) {
      const hardware = HARDWARE_GENERATION_PROFILES[generation];
      const sampleHz = SWAY_ANIMATION_PROFILES[generation].sampleHz;
      const blinkTime = (sampleHz * 3 - 1) / sampleHz;
      expect(titleAnimationFrame(hardware, blinkTime, true)).toMatchObject({
        angle: 0,
        pose: 'center',
      });
      expect(titleAnimationFrame(hardware, blinkTime, true).eyes).not.toBe('open');
    }
  });
});
