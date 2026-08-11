import { describe, expect, it } from 'vitest';
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
