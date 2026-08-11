import type { Score } from '@console-chaos/engine';

const BAR = 16;

/**
 * Small boot arrangement used while the full Phase 5 composition is built.
 * It already fixes the final transport contract: 132 BPM, 4/4, four-tick beats.
 */
export const RACING_MASTER_SCORE: Score = {
  bpm: 132,
  ticksPerBeat: 4,
  beatsPerBar: 4,
  tracks: [
    {
      role: 'lead',
      notes: [72, 76, 79, 81].map((pitch, bar) => ({
        tick: bar * BAR,
        durationTicks: 8,
        pitch,
        velocity: 0.72,
      })),
    },
    {
      role: 'bass',
      notes: [48, 45, 43, 47].map((pitch, bar) => ({
        tick: bar * BAR,
        durationTicks: BAR,
        pitch,
        velocity: 0.8,
      })),
    },
    {
      role: 'perc',
      notes: Array.from({ length: 16 }, (_, beat) => ({
        tick: beat * 4,
        durationTicks: 1,
        pitch: beat % 2 === 0 ? 36 : 53,
        velocity: 0.52,
      })),
    },
  ],
};
