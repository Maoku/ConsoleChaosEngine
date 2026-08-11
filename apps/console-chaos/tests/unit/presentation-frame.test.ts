import { describe, expect, it } from 'vitest';
import {
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
  it('builds every level entity plus player through the production GameModule', async () => {
    const level = loadLevelFile('mini');
    const loop = createManualLoopHost();
    const input = createMutableInputSource();
    const renderer = createRecordingRenderer();
    const host = createGameHost({
      loopHost: loop,
      input,
      renderer,
      audio: createNullAudioService(),
      initialGeneration: 'PS1',
    });
    await host.initialize(createConsoleChaosModule(level));
    host.frame(0);
    host.frame(17);
    expect(renderer.frames).toHaveLength(2);
    expect(renderer.frames.at(-1)?.meshes).toBeGreaterThan(0);
    expect(renderer.frames.at(-1)?.sprites).toBeGreaterThan(0);
    host.dispose();
  });
});
