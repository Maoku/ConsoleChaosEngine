import { describe, expect, it } from 'vitest';
import {
  TICK_SECONDS,
  createDeviceSnapshot,
  createGameHost,
  createNullAudioService,
} from '@console-chaos/engine';
import {
  createManualLoopHost,
  createMutableInputSource,
  createRecordingRenderer,
} from '@console-chaos/engine-testkit';
import { createConsoleChaosModule } from '@/app';
import { CONSOLE_CHAOS_GENERATION_THEMES } from '@/config/generation';
import {
  createModelJumpAnimationState,
  updateModelJumpAnimation,
} from '@/presentation/frame';
import { loadLevelFile } from './replay/harness';

describe('Console RenderFrame v2 presentation', () => {
  it('owns the complete module lifecycle and generation switching', async () => {
    const level = loadLevelFile('mini');
    const loop = createManualLoopHost();
    const input = createMutableInputSource();
    const renderer = createRecordingRenderer();
    const lifecycle = { create: 0, update: 0, render: 0, dispose: 0 };
    const host = createGameHost({
      loopHost: loop,
      input,
      renderer,
      audio: createNullAudioService(),
      initialGeneration: 'PS1',
    });
    await host.initialize(createConsoleChaosModule(level, {
      onCreate: () => lifecycle.create += 1,
      onFixedUpdate: () => lifecycle.update += 1,
      onRender: () => lifecycle.render += 1,
      onDispose: () => lifecycle.dispose += 1,
    }));
    input.set(createDeviceSnapshot(['Digit4']));
    host.frame(0);
    host.frame(17);
    expect(host.context.generation.generation).toBe('PS2');
    expect(renderer.frames).toHaveLength(2);
    expect(renderer.frames.at(-1)?.meshes).toBeGreaterThan(0);
    expect(renderer.frames.at(-1)?.sprites).toBeGreaterThan(0);
    expect(renderer.frames.at(-1)?.generation).toBe('PS2');
    expect(lifecycle).toEqual({ create: 1, update: 1, render: 2, dispose: 0 });
    host.dispose();
    host.dispose();
    expect(lifecycle.dispose).toBe(1);
  });
});

const player = CONSOLE_CHAOS_GENERATION_THEMES.PS1.player;
if (player.kind !== 'model') throw new Error('PS1 player must be a model');
const jump = player.clips.jump;

describe('Regular_Jump presentation state', () => {
  it('plays takeoff, confines a long airtime to frames 19-21, then plays landing once', () => {
    const state = createModelJumpAnimationState();
    updateModelJumpAnimation(state, { grounded: false, velocity: [0, 8, 0] }, jump);
    expect(state.phase).toBe('takeoff');
    expect(state.seconds).toBeCloseTo(1 / 30, 6);

    while (state.phase === 'takeoff') {
      updateModelJumpAnimation(state, { grounded: false, velocity: [0, -1, 0] }, jump);
    }
    expect(state.seconds).toBeCloseTo(19 / 30, 6);
    for (let tick = 0; tick < 600; tick++) {
      updateModelJumpAnimation(state, { grounded: false, velocity: [0, -8, 0] }, jump);
      expect(state.seconds).toBeGreaterThanOrEqual(19 / 30);
      expect(state.seconds).toBeLessThanOrEqual(21 / 30);
    }

    updateModelJumpAnimation(state, { grounded: true, velocity: [0, 0, 0] }, jump);
    expect(state.phase).toBe('landing');
    expect(state.seconds).toBeCloseTo(22 / 30, 6);
    let sawLastFrame = false;
    while (state.phase === 'landing') {
      updateModelJumpAnimation(state, { grounded: true, velocity: [0, 0, 0] }, jump);
      if (Math.abs(state.seconds - 58 / 30) < 1e-6) sawLastFrame = true;
    }
    expect(sawLastFrame).toBe(true);
    expect(state.phase).toBe('base');
  });

  it('starts at the airborne section when the player only walks off a ledge', () => {
    const state = createModelJumpAnimationState();
    updateModelJumpAnimation(state, { grounded: false, velocity: [0, -1, 0] }, jump, TICK_SECONDS);
    expect(state.phase).toBe('airborne');
    expect(state.seconds).toBeCloseTo(19 / 30, 6);
  });
});
