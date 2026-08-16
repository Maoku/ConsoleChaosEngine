import { describe, expect, it, vi } from 'vitest';
import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  createDeviceSnapshot,
  createGameHost,
  scoreLengthTicks,
  type Score,
} from '@console-chaos/engine';
import {
  createManualLoopHost,
  createMutableInputSource,
  createRecordingAudioService,
  createRecordingRenderer,
} from '@console-chaos/engine-testkit';
import { createTitleModule } from '../src/app';
import {
  TITLE_BGM_BARS,
  TITLE_BGM_BEATS_PER_BAR,
  TITLE_BGM_BPM,
  TITLE_BGM_SCORE,
  TITLE_BGM_TICKS_PER_BEAT,
  arrangeTitleScore,
} from '../src/audio';

function maximumSimultaneousNotes(score: Score): number {
  let maximum = 0;
  for (let tick = 0; tick < scoreLengthTicks(score); tick += 1) {
    let active = 0;
    for (const track of score.tracks) {
      active += track.notes.filter((note) =>
        note.tick <= tick && tick < note.tick + note.durationTicks,
      ).length;
    }
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

describe('generation-aware title BGM', () => {
  it('defines one deterministic 120 BPM four-bar loop', () => {
    expect(TITLE_BGM_SCORE.bpm).toBe(TITLE_BGM_BPM);
    expect(TITLE_BGM_SCORE.bpm).toBe(120);
    expect(TITLE_BGM_SCORE.beatsPerBar).toBe(TITLE_BGM_BEATS_PER_BAR);
    expect(TITLE_BGM_SCORE.ticksPerBeat).toBe(TITLE_BGM_TICKS_PER_BEAT);
    expect(scoreLengthTicks(TITLE_BGM_SCORE)).toBe(
      TITLE_BGM_BARS * TITLE_BGM_BEATS_PER_BAR * TITLE_BGM_TICKS_PER_BEAT,
    );
  });

  it('adds tracks monotonically from audio capabilities without changing musical time', () => {
    const arrangements = GENERATION_IDS.map((generation) =>
      arrangeTitleScore(HARDWARE_GENERATION_PROFILES[generation]),
    );
    expect(arrangements.map((score) => score.tracks.length)).toEqual([3, 4, 5, 6]);
    for (const [index, score] of arrangements.entries()) {
      const profile = HARDWARE_GENERATION_PROFILES[GENERATION_IDS[index] ?? 'FC'];
      expect(score.bpm).toBe(TITLE_BGM_BPM);
      expect(score.beatsPerBar).toBe(TITLE_BGM_BEATS_PER_BAR);
      expect(scoreLengthTicks(score)).toBe(scoreLengthTicks(TITLE_BGM_SCORE));
      expect(maximumSimultaneousNotes(score)).toBeLessThanOrEqual(profile.audio.channels);
    }
  });

  it('starts once and swaps the arrangement without restarting on generation change', async () => {
    const loopHost = createManualLoopHost();
    const input = createMutableInputSource();
    const audio = createRecordingAudioService(TITLE_BGM_BPM);
    const playScore = vi.spyOn(audio, 'playScore');
    const useScore = vi.spyOn(audio, 'useScore');
    const host = createGameHost({
      loopHost,
      input,
      audio,
      renderer: createRecordingRenderer(),
      initialGeneration: 'FC',
    });
    await host.initialize(createTitleModule());
    expect(playScore).toHaveBeenCalledOnce();
    expect(playScore.mock.calls[0]?.[0].tracks).toHaveLength(3);
    expect(audio.currentSourceKey).toBe('psg');

    input.set(createDeviceSnapshot(['KeyE']));
    host.frame(0);
    host.frame(17);
    input.set(createDeviceSnapshot());
    host.frame(34);

    expect(playScore).toHaveBeenCalledOnce();
    expect(useScore).toHaveBeenCalledOnce();
    expect(useScore.mock.calls[0]?.[0].tracks).toHaveLength(4);
    expect(audio.currentSourceKey).toBe('brr');
    expect(audio.profiles.at(-1)?.id).toBe('SFC');
    host.dispose();
  });
});
