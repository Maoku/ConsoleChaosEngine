import { describe, expect, it } from 'vitest';
import {
  FORCED_SWITCH_DURATION_MS,
  FORCED_WARNING_MS,
  NORMAL_SWITCH_DURATION_MS,
  createGenerationController,
} from '../src/generation/controller';
import { HARDWARE_GENERATION_PROFILES } from '../src/generation/profiles';
import { createActionMap, createDeviceSnapshot, defineActions } from '../src/input/actions';

describe('generation controller', () => {
  it('uses 350/600ms, last-request-wins queue, and transition invulnerability', () => {
    const controller = createGenerationController('FC');
    expect(controller.request('SFC')).toBe(true);
    expect(controller.transition.durationMs).toBe(NORMAL_SWITCH_DURATION_MS);
    expect(controller.invulnerable).toBe(true);
    controller.request('PS1');
    controller.request('PS2');
    controller.advance(NORMAL_SWITCH_DURATION_MS);
    expect(controller.generation).toBe('PS2');
    controller.advance(NORMAL_SWITCH_DURATION_MS);
    expect(controller.invulnerable).toBe(false);
    controller.force('FC');
    expect(controller.transition.durationMs).toBe(FORCED_SWITCH_DURATION_MS);
  });

  it('emits profile-complete before/start/after events in order', () => {
    const controller = createGenerationController('FC');
    const order: string[] = [];
    controller.onBeforeSwitch((event) => {
      order.push(`before:${controller.generation}`);
      expect(event.fromProfile).toBe(HARDWARE_GENERATION_PROFILES.FC);
      expect(event.toProfile).toBe(HARDWARE_GENERATION_PROFILES.SFC);
    });
    controller.onSwitch(() => order.push(`start:${controller.generation}`));
    controller.onAfterSwitch(() => order.push(`after:${controller.generation}`));
    controller.request('SFC');
    controller.advance(NORMAL_SWITCH_DURATION_MS);
    expect(order).toEqual(['before:FC', 'start:SFC', 'after:SFC']);
  });

  it('preserves a queued forced request and supports warning cancellation/release', () => {
    const controller = createGenerationController('FC');
    const warnings: string[] = [];
    controller.onForcedWarning(({ to, leadMs }) => warnings.push(`${to}:${leadMs}`));
    controller.scheduleForced('PS2');
    expect(controller.warningRemainingMs).toBe(FORCED_WARNING_MS);
    expect(warnings).toEqual([`PS2:${FORCED_WARNING_MS}`]);
    controller.cancelForcedWarning();
    expect(controller.warningTo).toBeNull();

    controller.request('SFC');
    controller.force('PS1');
    expect(controller.request('PS2')).toBe(false);
    expect(controller.pending).toBe('PS1');
    controller.advance(NORMAL_SWITCH_DURATION_MS);
    expect(controller.generation).toBe('PS1');
    expect(controller.forced).toBe(true);
    controller.releaseForced();
    expect(controller.forced).toBe(false);
  });
});

describe('generic action map', () => {
  const actions = defineActions({ move: 'axis2d', fire: 'button', steer: 'axis1d' });
  const map = createActionMap(actions, {
    move: { leftKeys: ['KeyA'], rightKeys: ['KeyD'], upKeys: ['KeyW'], downKeys: ['KeyS'] },
    fire: { keys: ['Space'], gamepadButtons: [0] },
    steer: { negativeKeys: ['ArrowLeft'], positiveKeys: ['ArrowRight'], gamepadAxis: 0 },
  });

  it('applies generation direction constraints without game-specific names', () => {
    const input = createDeviceSnapshot(['KeyD', 'KeyW', 'Space']);
    const fc = map.sample(input, HARDWARE_GENERATION_PROFILES.FC);
    expect(fc.move).toEqual([1, 0]);
    expect(fc.fire.pressed).toBe(true);
    const ps2 = map.sample(input, HARDWARE_GENERATION_PROFILES.PS2);
    expect(ps2.move[0]).toBeCloseTo(Math.SQRT1_2);
    expect(ps2.move[1]).toBeCloseTo(-Math.SQRT1_2);
    expect(ps2.fire.pressed).toBe(false);
  });
});
