import type {
  HardwareGenerationProfile,
  Note,
  Score,
  Track,
  TrackRole,
} from '@console-chaos/engine';

export const TITLE_BGM_BPM = 120;
export const TITLE_BGM_TICKS_PER_BEAT = 4;
export const TITLE_BGM_BEATS_PER_BAR = 4;
export const TITLE_BGM_BARS = 4;
const BAR_TICKS = TITLE_BGM_TICKS_PER_BEAT * TITLE_BGM_BEATS_PER_BAR;

function notes(
  rows: ReadonlyArray<readonly [tick: number, pitch: number, durationTicks: number]>,
  velocity: number,
): Note[] {
  return rows.map(([tick, pitch, durationTicks]) => ({ tick, pitch, durationTicks, velocity }));
}

function repeatBars(
  rows: ReadonlyArray<readonly [tick: number, pitch: number, durationTicks: number]>,
): Array<readonly [number, number, number]> {
  return Array.from({ length: TITLE_BGM_BARS }, (_, bar) =>
    rows.map(([tick, pitch, duration]) => [bar * BAR_TICKS + tick, pitch, duration] as const),
  ).flat();
}

function track(role: TrackRole, trackNotes: Note[]): Track {
  return { role, notes: trackNotes };
}

const LEAD = track('lead', notes([
  [0, 76, 2], [2, 79, 2], [4, 81, 2], [6, 79, 2], [8, 76, 4], [12, 72, 4],
  [16, 77, 2], [18, 81, 2], [20, 84, 2], [22, 81, 2], [24, 79, 4], [28, 76, 4],
  [32, 76, 2], [34, 79, 2], [36, 83, 2], [38, 79, 2], [40, 81, 4], [44, 79, 4],
  [48, 77, 2], [50, 76, 2], [52, 74, 2], [54, 76, 2], [56, 79, 4], [60, 72, 4],
], 0.86));

const BASS = track('bass', notes([
  ...repeatBars([[0, 48, 4], [4, 55, 4], [8, 52, 4], [12, 55, 4]]),
], 0.72));

const PERCUSSION = track('perc', notes(repeatBars([
  [0, 36, 1], [2, 65, 1], [6, 65, 1], [8, 53, 1], [10, 65, 1], [14, 65, 1],
]), 0.64));

const PAD = track('pad', notes([
  [0, 60, 16], [0, 67, 16],
  [16, 65, 16], [16, 69, 16],
  [32, 64, 16], [32, 67, 16],
  [48, 62, 16], [48, 67, 16],
], 0.36));

const HARMONY = track('lead', notes([
  [0, 67, 4], [4, 69, 4], [8, 67, 4], [12, 64, 4],
  [16, 69, 4], [20, 72, 4], [24, 71, 4], [28, 69, 4],
  [32, 67, 4], [36, 71, 4], [40, 69, 4], [44, 67, 4],
  [48, 65, 4], [52, 64, 4], [56, 67, 4], [60, 64, 4],
], 0.4));

const ACCENTS = track('fx', notes([
  [6, 88, 1], [14, 91, 1], [22, 88, 1], [30, 93, 1],
  [38, 91, 1], [46, 88, 1], [54, 86, 1], [62, 91, 1],
], 0.3));

const TITLE_TRACKS = [LEAD, BASS, PERCUSSION, PAD, HARMONY, ACCENTS] as const;

export const TITLE_BGM_SCORE: Score = {
  bpm: TITLE_BGM_BPM,
  ticksPerBeat: TITLE_BGM_TICKS_PER_BEAT,
  beatsPerBar: TITLE_BGM_BEATS_PER_BAR,
  tracks: [...TITLE_TRACKS],
};

export function arrangeTitleScore(profile: HardwareGenerationProfile): Score {
  const trackCount = profile.audio.channels >= 48
    ? 6
    : profile.audio.channels >= 24
      ? 5
      : profile.audio.channels >= 8
        ? 4
        : 3;
  return {
    ...TITLE_BGM_SCORE,
    tracks: TITLE_TRACKS.slice(0, trackCount),
  };
}
