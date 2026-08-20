import { describe, expect, it, vi } from 'vitest';
import {
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
import { createNeutralConsoleChaosActions } from '@/config/actions';
import type { Session } from '@/gameplay/session';
import { loadLevelFile } from '../unit/replay/harness';

describe('Console Chaos production-host lifecycle', () => {
  it('boots gameplay, solves, switches, resets, and disposes through public engine APIs', async () => {
    const loopHost = createManualLoopHost();
    const input = createMutableInputSource();
    const renderer = createRecordingRenderer();
    const baseAudio = createNullAudioService(132);
    const audio = {
      ...baseAudio,
      unlock: vi.fn(async () => {}),
      setGenerationVoiceLimit: vi.fn(),
      setGenerationProfile: vi.fn(),
      playScore: vi.fn(),
      useScore: vi.fn(),
      dispose: vi.fn(),
    };
    const lifecycle = { create: 0, update: 0, render: 0, dispose: 0 };
    let session: Session | null = null;
    let disposedModule = '';
    const host = createGameHost({
      loopHost,
      input,
      renderer,
      audio,
      initialGeneration: 'PS1',
      seed: 0x436861,
    });
    host.context.events.on('disposed', ({ moduleId }) => disposedModule = moduleId);

    await host.initialize(createConsoleChaosModule(loadLevelFile('area1'), {
      onCreate(created) {
        lifecycle.create += 1;
        session = created;
      },
      onFixedUpdate: () => lifecycle.update += 1,
      onRender: () => lifecycle.render += 1,
      onDispose: () => lifecycle.dispose += 1,
    }));

    expect(session).not.toBeNull();
    await host.context.audio.unlock();
    expect(audio.unlock).toHaveBeenCalledOnce();
    expect(audio.playScore).toHaveBeenCalledOnce();
    expect(audio.setGenerationProfile.mock.calls.at(-1)?.[0].id).toBe('PS1');

    const activeSession = session as unknown as Session;
    activeSession.player.position = [29.5, 0.5, 0];
    host.frame(0);
    host.frame(17);
    expect(activeSession.solved).toContain('F-1');
    expect(renderer.frames.at(-1)?.meshes).toBeGreaterThan(0);
    expect(renderer.frames.at(-1)?.sprites).toBeGreaterThan(0);

    let now = 17;
    for (const [key, generation] of [
      ['Digit1', 'FC'],
      ['Digit2', 'SFC'],
      ['Digit3', 'PS1'],
      ['Digit4', 'PS2'],
    ] as const) {
      input.set(createDeviceSnapshot([key]));
      host.frame(now += 17);
      input.set(createDeviceSnapshot());
      host.frame(now += 17);
      for (let frame = 0; frame < 21; frame++) host.frame(now += 17);
      expect(host.context.generation.generation).toBe(generation);
      expect(host.context.generation.transition.active).toBe(false);
      expect(renderer.frames.at(-1)?.generation).toBe(generation);
    }
    expect(audio.setGenerationProfile.mock.calls.map(([profile]) => profile.id)).toEqual([
      'PS1', 'FC', 'SFC', 'PS1', 'PS2',
    ]);

    const tickBeforeReset = activeSession.tickIndex;
    activeSession.reset();
    expect(activeSession.solved.size).toBe(0);
    // legacy の R 操作と同じく、演出時刻は継続してゲーム状態だけを戻す。
    expect(activeSession.tickIndex).toBe(tickBeforeReset);
    expect(activeSession.player.position).toEqual(loadLevelFile('area1').spawn.position);

    host.dispose();
    host.dispose();
    expect(lifecycle.create).toBe(1);
    expect(lifecycle.update).toBeGreaterThan(80);
    expect(lifecycle.render).toBeGreaterThan(80);
    expect(Math.abs(lifecycle.render - lifecycle.update)).toBeLessThanOrEqual(1);
    expect(lifecycle.dispose).toBe(1);
    expect(disposedModule).toBe('console-chaos');
    expect(audio.dispose).toHaveBeenCalledOnce();
    expect(host.context.assets.activeCount).toBe(0);
    expect(host.context.world.entityCount).toBe(0);
  });

  it('title and clear overlays can pause simulation without stopping rendering', async () => {
    const loopHost = createManualLoopHost();
    const renderer = createRecordingRenderer();
    let playable = false;
    let session: Session | null = null;
    const host = createGameHost({
      loopHost,
      renderer,
      input: createMutableInputSource(),
      initialGeneration: 'PS1',
    });

    await host.initialize(createConsoleChaosModule(loadLevelFile('mini'), {
      onCreate(created) {
        session = created;
      },
      shouldSimulate: () => playable,
    }));
    const activeSession = session as unknown as Session;

    host.frame(0);
    host.frame(17);
    expect(activeSession.tickIndex).toBe(0);
    expect(renderer.frames.length).toBeGreaterThan(0);

    playable = true;
    host.frame(34);
    expect(activeSession.tickIndex).toBe(1);

    playable = false;
    host.frame(51);
    expect(activeSession.tickIndex).toBe(1);
    expect(renderer.frames.length).toBeGreaterThan(2);

    host.dispose();
  });

  it('routes injected demo actions through the normal fixed-update lifecycle', async () => {
    const loopHost = createManualLoopHost();
    let session: Session | null = null;
    const host = createGameHost({
      loopHost,
      renderer: createRecordingRenderer(),
      input: createMutableInputSource(),
      initialGeneration: 'FC',
    });
    await host.initialize(createConsoleChaosModule(loadLevelFile('mini'), {
      onCreate(created) {
        session = created;
      },
      overrideActions() {
        return { ...createNeutralConsoleChaosActions(), move: [1, 0] };
      },
    }));
    const activeSession = session as unknown as Session;
    const startX = activeSession.player.position[0];
    for (let frame = 0; frame <= 30; frame++) host.frame(frame * 17);
    expect(activeSession.player.position[0]).toBeGreaterThan(startX);
    host.dispose();
  });
});
