import { describe, expect, it } from 'vitest';
import { createDeviceSnapshot } from '@console-chaos/engine';
import { createManualLoopHost, createMutableInputSource, createRecordingAudioService, createRecordingRenderer } from '../src';

describe('engine-testkit', () => {
  it('provides deterministic fakes without browser globals', () => {
    const host = createManualLoopHost();
    host.setNow(10);
    expect(host.now()).toBe(10);

    const input = createMutableInputSource();
    input.set(createDeviceSnapshot(['ArrowUp']));
    expect(input.poll().keys.has('ArrowUp')).toBe(true);

    const audio = createRecordingAudioService();
    audio.playTone(440, 0.1);
    expect(audio.tones).toHaveLength(1);

    expect(createRecordingRenderer().frames).toHaveLength(0);
  });
});

