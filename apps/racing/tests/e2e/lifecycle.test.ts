import { describe, expect, it } from 'vitest';
import { createDeviceSnapshot, createGameHost } from '@console-chaos/engine';
import { createManualLoopHost, createMutableInputSource, createRecordingAudioService, createRecordingRenderer } from '@console-chaos/engine-testkit';
import { RACING_GAME_MODULE } from '@racing/app';

describe('racing public-engine integration', () => {
  it('boots, updates, renders, switches generation, and disposes through public APIs', async () => {
    const loopHost = createManualLoopHost();
    const input = createMutableInputSource();
    const renderer = createRecordingRenderer();
    const audio = createRecordingAudioService(132);
    const host = createGameHost({ loopHost, input, renderer, audio, initialGeneration: 'FC' });
    await host.initialize(RACING_GAME_MODULE);
    const initialBar = audio.barPosition;

    host.frame(0);
    input.set(createDeviceSnapshot(['Digit4', 'ArrowUp']));
    host.frame(17);
    expect(host.context.generation.generation).toBe('PS2');
    expect(renderer.frames.at(-1)?.generation).toBe('PS2');
    expect(renderer.frames.at(-1)?.meshes).toBeGreaterThan(2);
    expect(renderer.frames.at(-1)?.sprites).toBe(0);
    expect(renderer.frames.at(-1)?.overlays).toBe(0);
    expect(audio.currentSourceKey).toBe('streaming');
    expect(audio.scores.length).toBeGreaterThanOrEqual(2);
    expect(audio.barPosition).toBe(initialBar);

    input.set(createDeviceSnapshot());
    for (let time = 34; time < 3_200; time += 17) host.frame(time);
    expect(audio.tones.length).toBeGreaterThan(0);
    host.dispose();
    expect(host.context.assets.activeCount).toBe(0);
    expect(host.context.events.listenerCount('generationSwitch')).toBe(0);
  });
});
