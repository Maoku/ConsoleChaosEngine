import type { Note, Score, Track } from '@console-chaos/engine';

export const RACING_BPM = 132;
export const RACING_TICKS_PER_BEAT = 4;
export const RACING_BEATS_PER_BAR = 4;
export const RACING_BAR_TICKS = RACING_TICKS_PER_BEAT * RACING_BEATS_PER_BAR;
export const RACING_BARS = 8;

const ROOTS = [48, 45, 41, 43, 48, 45, 41, 43] as const;
const LEAD_SHAPES = [
  [0, 7, 12, 9, 7, 4],
  [0, 3, 7, 10, 7, 3],
  [0, 4, 7, 12, 9, 7],
  [0, 4, 7, 11, 9, 7],
] as const;

function note(tick: number, durationTicks: number, pitch: number, velocity: number): Note {
  return { tick, durationTicks, pitch, velocity };
}

function leadTrack(): Track {
  const notes: Note[] = [];
  for (let bar = 0; bar < RACING_BARS; bar++) {
    const root = ROOTS[bar] ?? 48;
    const shape = LEAD_SHAPES[bar % LEAD_SHAPES.length] ?? LEAD_SHAPES[0];
    for (let slot = 0; slot < shape.length; slot++) {
      notes.push(note(bar * RACING_BAR_TICKS + slot * 2, slot === shape.length - 1 ? 6 : 2, root + 24 + (shape[slot] ?? 0), 0.76));
    }
  }
  return { role: 'lead', notes };
}

function bassTrack(): Track {
  return {
    role: 'bass',
    notes: ROOTS.flatMap((root, bar) => [
      note(bar * RACING_BAR_TICKS, 6, root, 0.82),
      note(bar * RACING_BAR_TICKS + 8, 4, root + 7, 0.72),
      note(bar * RACING_BAR_TICKS + 12, 4, root + 12, 0.62),
    ]),
  };
}

function percussionTrack(): Track {
  const notes: Note[] = [];
  for (let bar = 0; bar < RACING_BARS; bar++) {
    for (let step = 0; step < 8; step++) {
      const tick = bar * RACING_BAR_TICKS + step * 2;
      const pitch = step === 0 || step === 3 ? 36 : step === 4 ? 53 : 65;
      notes.push(note(tick, step === 0 || step === 4 ? 2 : 1, pitch, step % 4 === 0 ? 0.66 : 0.42));
    }
  }
  return { role: 'perc', notes };
}

function padTrack(): Track {
  return {
    role: 'pad',
    notes: ROOTS.flatMap((root, bar) => [0, 4, 7].map((offset) => (
      note(bar * RACING_BAR_TICKS, RACING_BAR_TICKS, root + 12 + offset, 0.34)
    ))),
  };
}

/** One composition; generation arrangements only remove or layer these notes. */
export const RACING_MASTER_SCORE: Score = {
  bpm: RACING_BPM,
  ticksPerBeat: RACING_TICKS_PER_BEAT,
  beatsPerBar: RACING_BEATS_PER_BAR,
  tracks: [leadTrack(), bassTrack(), percussionTrack(), padTrack()],
};
