import { describe, expect, it } from 'vitest';
import { GENERATION_IDS, HARDWARE_GENERATION_PROFILES } from '@console-chaos/engine';
import {
  SWAY_ANIMATION_PROFILES,
  titleAnimationFrame,
} from '../src/animation';

describe('title character animation', () => {
  it('uses profile animation rates and asset-only body poses for FC/SFC/PS2', () => {
    for (const generation of ['FC', 'SFC', 'PS2'] as const) {
      const hardware = HARDWARE_GENERATION_PROFILES[generation];
      const sampleHz = SWAY_ANIMATION_PROFILES[generation].sampleHz;
      expect(sampleHz).toBe(hardware.video.animationHz);
      const poses = new Set<string>();
      for (let sample = 0; sample < sampleHz; sample += 1) {
        const start = sample / sampleHz;
        const atStart = titleAnimationFrame(hardware, start, false);
        const beforeNext = titleAnimationFrame(hardware, start + 0.999 / sampleHz, false);
        expect(beforeNext).toEqual(atStart);
        expect(atStart.tween).toEqual({
          from: atStart.pose,
          to: atStart.pose,
          progress: 0,
        });
        poses.add(atStart.pose);
      }
      expect([...poses].sort()).toEqual(['center', 'left', 'right']);
    }
  });

  it('Tweens PS1 only across left-center and center-right image pairs', () => {
    const allowedPairs = new Set([
      'left:center',
      'center:right',
      'right:center',
      'center:left',
    ]);
    for (const generation of ['PS1'] as const) {
      const hardware = HARDWARE_GENERATION_PROFILES[generation];
      const sampleHz = SWAY_ANIMATION_PROFILES[generation].sampleHz;
      expect(sampleHz).toBe(hardware.video.animationHz);
      const states = Array.from({ length: sampleHz }, (_, sample) =>
        titleAnimationFrame(hardware, sample / sampleHz, false),
      );
      expect(states[0]?.tween).toEqual({ from: 'left', to: 'center', progress: 0 });
      expect(states[Math.floor(sampleHz / 2)]?.tween)
        .toEqual({ from: 'right', to: 'center', progress: 0 });
      for (const state of states) {
        expect(allowedPairs.has(`${state.tween.from}:${state.tween.to}`)).toBe(true);
        expect(state.tween.progress).toBeGreaterThanOrEqual(0);
        expect(state.tween.progress).toBeLessThanOrEqual(1);
        expect(state.pose).toBe(state.tween.progress < 0.5 ? state.tween.from : state.tween.to);
      }
    }
  });

  it('eases monotonically within each PS1 texture pair', () => {
    for (const generation of ['PS1'] as const) {
      const hardware = HARDWARE_GENERATION_PROFILES[generation];
      const sampleHz = hardware.video.animationHz;
      const states = Array.from({ length: sampleHz }, (_, sample) =>
        titleAnimationFrame(hardware, sample / sampleHz, false).tween,
      );
      for (let index = 1; index < states.length; index += 1) {
        const previous = states[index - 1]!;
        const current = states[index]!;
        if (previous.from === current.from && previous.to === current.to) {
          expect(current.progress).toBeGreaterThanOrEqual(previous.progress);
        }
      }
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

  it('freezes body motion at center but preserves blinking for reduced motion', () => {
    for (const generation of GENERATION_IDS) {
      const hardware = HARDWARE_GENERATION_PROFILES[generation];
      const sampleHz = SWAY_ANIMATION_PROFILES[generation].sampleHz;
      const blinkTime = (sampleHz * 3 - 1) / sampleHz;
      expect(titleAnimationFrame(hardware, blinkTime, true)).toMatchObject({
        pose: 'center',
        tween: { from: 'center', to: 'center', progress: 0 },
      });
      expect(titleAnimationFrame(hardware, blinkTime, true).eyes).not.toBe('open');
    }
  });
});
