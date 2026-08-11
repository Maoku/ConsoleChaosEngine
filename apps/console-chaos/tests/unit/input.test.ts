import { describe, expect, it } from 'vitest';
import {
  HARDWARE_GENERATION_PROFILES,
  createDeviceSnapshot,
  createKeyboardGamepadSource,
} from '@console-chaos/engine';
import { createConsoleChaosActionMap } from '@/config/actions';
import {
  BUFFER_FRAMES,
  COYOTE_FRAMES,
  cancelCoyote,
  consumeActionBuffer,
  createActionBuffer,
  updateActionBuffer,
} from '@/input/buffer';
import { deviceSnapshotForInput } from './session-testkit';

describe('Console ActionMap contract', () => {
  it('reproduces four-way last-axis tie break and digital/analog generations', () => {
    const map = createConsoleChaosActionMap();
    expect(map.sample(
      deviceSnapshotForInput({ move: [1, 1], lastAxis: 1 }),
      HARDWARE_GENERATION_PROFILES.FC,
    ).move).toEqual([0, 1]);
    expect(map.sample(
      deviceSnapshotForInput({ move: [1, 1], lastAxis: 0 }),
      HARDWARE_GENERATION_PROFILES.FC,
    ).move).toEqual([1, 0]);
    expect(map.sample(
      deviceSnapshotForInput({ move: [0.4, -0.9] }),
      HARDWARE_GENERATION_PROFILES.SFC,
    ).move).toEqual([1, -1]);
    const analog = map.sample(
      deviceSnapshotForInput({ move: [0.4, -0.25] }),
      HARDWARE_GENERATION_PROFILES.PS1,
    ).move;
    expect(analog[0]).toBeCloseTo(0.4, 6);
    expect(analog[1]).toBeCloseTo(-0.25, 6);
  });

  it('normalizes diagonal analog input and applies the 0.25 gamepad deadzone', () => {
    const map = createConsoleChaosActionMap();
    const diagonal = map.sample(
      deviceSnapshotForInput({ move: [1, 1] }),
      HARDWARE_GENERATION_PROFILES.PS2,
    ).move;
    expect(Math.hypot(...diagonal)).toBeCloseTo(1, 6);
    expect(map.sample(
      createDeviceSnapshot([], [], [0.2, 0]),
      HARDWARE_GENERATION_PROFILES.PS2,
    ).move).toEqual([0, 0]);
  });

  it('tracks button edges, held time, and pressure ramp without RawInput conversion', () => {
    const map = createConsoleChaosActionMap();
    let snapshot = map.sample(
      createDeviceSnapshot(['Space', 'KeyL']),
      HARDWARE_GENERATION_PROFILES.PS2,
      250,
    );
    expect(snapshot.jump).toMatchObject({ down: true, pressed: true, released: false, heldMs: 0 });
    expect(snapshot.pressure.value).toBe(0);
    snapshot = map.sample(
      createDeviceSnapshot(['Space', 'KeyL']),
      HARDWARE_GENERATION_PROFILES.PS2,
      250,
    );
    expect(snapshot.jump.heldMs).toBe(250);
    expect(snapshot.pressure.value).toBe(0.5);
    snapshot = map.sample(createDeviceSnapshot(), HARDWARE_GENERATION_PROFILES.PS2, 16);
    expect(snapshot.jump.released).toBe(true);
    expect(snapshot.pressure.value).toBe(0);
  });

  it('emits direct and cycle switches only on the pressed edge', () => {
    const map = createConsoleChaosActionMap();
    expect(map.sample(createDeviceSnapshot(['Digit3']), HARDWARE_GENERATION_PROFILES.PS1).switch3.pressed).toBe(true);
    expect(map.sample(createDeviceSnapshot(['Digit3']), HARDWARE_GENERATION_PROFILES.PS1).switch3.pressed).toBe(false);
    expect(map.sample(createDeviceSnapshot(['KeyE']), HARDWARE_GENERATION_PROFILES.PS1).switchNext.pressed).toBe(true);
  });

  it('clears held keyboard state on focus loss', () => {
    const target = new EventTarget();
    const source = createKeyboardGamepadSource(target as Window);
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyD' }));
    expect(source.poll().keys.has('KeyD')).toBe(true);
    target.dispatchEvent(new Event('blur'));
    expect(source.poll().keys.size).toBe(0);
    source.dispose();
  });
});

describe('generic action buffer', () => {
  it('buffers a press for eight frames and consumes it once on landing', () => {
    const buffer = createActionBuffer();
    updateActionBuffer(buffer, true, false);
    for (let frame = 1; frame < BUFFER_FRAMES - 1; frame++) {
      updateActionBuffer(buffer, false, false);
      expect(consumeActionBuffer(buffer)).toBe(false);
    }
    updateActionBuffer(buffer, false, true);
    expect(consumeActionBuffer(buffer)).toBe(true);
    expect(consumeActionBuffer(buffer)).toBe(false);
  });

  it('expires buffer and coyote windows at their declared limits', () => {
    const expired = createActionBuffer();
    updateActionBuffer(expired, true, false);
    for (let frame = 1; frame < BUFFER_FRAMES; frame++) updateActionBuffer(expired, false, false);
    updateActionBuffer(expired, false, true);
    expect(consumeActionBuffer(expired)).toBe(false);

    const coyote = createActionBuffer();
    updateActionBuffer(coyote, false, true);
    for (let frame = 1; frame < COYOTE_FRAMES; frame++) updateActionBuffer(coyote, false, false);
    updateActionBuffer(coyote, true, false);
    expect(consumeActionBuffer(coyote)).toBe(true);
    cancelCoyote(coyote);
    expect(consumeActionBuffer(coyote)).toBe(false);
  });
});
