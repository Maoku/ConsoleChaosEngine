import type { HardwareGenerationProfile, Note, Score, Track, TrackRole } from '@console-chaos/engine';
import { RACING_TICKS_PER_BEAT } from './score';

function notesOf(score: Score, role: TrackRole): Note[] {
  return score.tracks.filter((track) => track.role === role).flatMap((track) => track.notes);
}

function shifted(notes: readonly Note[], semitones: number, velocityScale: number): Note[] {
  return notes.map((note) => ({
    ...note,
    pitch: note.pitch + semitones,
    velocity: note.velocity * velocityScale,
  }));
}

export function arrangeRacingScore(profile: HardwareGenerationProfile, master: Score): Score {
  const lead = notesOf(master, 'lead');
  const percussion = notesOf(master, 'perc');
  const tracks: Track[] = [
    { role: 'lead', notes: lead },
    { role: 'bass', notes: notesOf(master, 'bass') },
    {
      role: 'perc',
      notes: profile.audio.channels < 8
        ? percussion.filter((note) => note.tick % (RACING_TICKS_PER_BEAT * 2) === 0)
        : percussion,
    },
  ];
  if (profile.audio.channels >= 8) tracks.push({ role: 'pad', notes: notesOf(master, 'pad') });
  if (profile.audio.channels >= 24) tracks.push({ role: 'lead', notes: shifted(lead, -5, 0.5) });
  if (profile.audio.channels >= 48) tracks.push({ role: 'pad', notes: shifted(notesOf(master, 'pad'), 12, 0.24) });
  return { ...master, tracks };
}
