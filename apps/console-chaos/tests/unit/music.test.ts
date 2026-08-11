import { describe, expect, it } from 'vitest';
import { GENERATION_IDS, HARDWARE_GENERATION_PROFILES, scoreLengthTicks } from '@console-chaos/engine';
import {
  AMBIENCE_MIN_CHANNELS,
  AREA1_SONG_POP,
  HARMONY_MIN_CHANNELS,
  PAD_MIN_CHANNELS,
  SFX_HEADROOM_VOICES,
  arrangeFor,
  maxSimultaneousVoices,
  sameBarStructure,
} from '@/audio/music';
import { MAX_SFX_LAYERS, SFX, sfxLayers, sfxRequests, sweepSteps } from '@/audio/sfx';
import { DEFAULT_SONG_ID, SONGS, nextSongId, songOf } from '@/audio/songs';

const DEFAULT_SONG = songOf(DEFAULT_SONG_ID);

describe('Console music arrangements', () => {
  it('preserves tempo, meter, and loop length through every generation', () => {
    const scores = GENERATION_IDS.map((id) => arrangeFor(HARDWARE_GENERATION_PROFILES[id]));
    for (const score of scores) {
      expect(sameBarStructure(score, scores[0]!)).toBe(true);
      expect(scoreLengthTicks(score)).toBe(scoreLengthTicks(AREA1_SONG_POP));
    }
  });

  it('derives density from public hardware limits and leaves SFX headroom', () => {
    for (const id of GENERATION_IDS) {
      const hardware = HARDWARE_GENERATION_PROFILES[id];
      expect(maxSimultaneousVoices(arrangeFor(hardware))).toBeLessThanOrEqual(
        hardware.audio.channels - SFX_HEADROOM_VOICES,
      );
    }
    expect(HARDWARE_GENERATION_PROFILES.SFC.audio.channels).toBe(PAD_MIN_CHANNELS);
    expect(HARDWARE_GENERATION_PROFILES.PS1.audio.channels).toBe(HARMONY_MIN_CHANNELS);
    expect(HARDWARE_GENERATION_PROFILES.PS2.audio.channels).toBe(AMBIENCE_MIN_CHANNELS);
  });
});

describe('song catalog', () => {
  it('has a stable default, unique ids, and a complete cycle', () => {
    expect(songOf(null)).toBe(DEFAULT_SONG);
    expect(new Set(SONGS.map((song) => song.id)).size).toBe(SONGS.length);
    let current = DEFAULT_SONG;
    for (let index = 0; index < SONGS.length; index++) current = songOf(nextSongId(current.id));
    expect(current.id).toBe(DEFAULT_SONG.id);
  });

  it('falls back to the default for an unknown external id', () => {
    expect(songOf('unknown')).toBe(DEFAULT_SONG);
  });
});

describe('Console sound effects', () => {
  it('produces every cue on every public hardware profile', () => {
    for (const id of Object.keys(SFX) as Array<keyof typeof SFX>) {
      for (const generation of GENERATION_IDS) {
        expect(sfxRequests(id, HARDWARE_GENERATION_PROFILES[generation], 0).length).toBeGreaterThan(0);
      }
    }
  });

  it('gets denser with available voices and keeps the FC sweep coarse', () => {
    expect(GENERATION_IDS.map((id) => sfxLayers(HARDWARE_GENERATION_PROFILES[id]))).toEqual([1, 1, 2, MAX_SFX_LAYERS]);
    expect(sweepSteps(HARDWARE_GENERATION_PROFILES.FC)).toBe(3);
    expect(sweepSteps(HARDWARE_GENERATION_PROFILES.SFC)).toBe(6);
  });

  it('adds pan only when the hardware supports positional audio', () => {
    expect(sfxRequests('solve', HARDWARE_GENERATION_PROFILES.PS2, 0, { pan: -0.5 })[0]?.pan).toBe(-0.5);
    expect(sfxRequests('solve', HARDWARE_GENERATION_PROFILES.FC, 0, { pan: -0.5 })[0]?.pan).toBeUndefined();
  });
});
