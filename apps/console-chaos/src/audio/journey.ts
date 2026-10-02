import type { Note, Score } from '@console-chaos/engine';

/** Original 32-bar suites: exploration A, answering A', tension B, opening C. */
export function journeyScore(stage = 0): Score {
  const lead: Note[] = [], bass: Note[] = [], perc: Note[] = [], pad: Note[] = [];
  const motifs = [[0,7,10,7,3,2], [7,10,14,12,10,7], [12,10,7,5,3,2], [7,12,14,15,14,10]];
  const roots = [45,41,48,43,50,45,41,40];
  const transposition = [0,2,-2,0][stage] ?? 0;
  for (let bar = 0; bar < 32; bar++) {
    const section = Math.floor(bar / 8);
    const root = roots[(bar + (section === 2 ? 4 : 0)) % 8]! + transposition;
    const major = [41,48,43,40].includes(root - transposition);
    const chord = [root+12, root+12+(major ? 4 : 3), root+19];
    const motif = motifs[(section + stage) % 4]!;
    const positions = section === 2 ? [0,2,5,8,10,14] : [0,3,6,8,12,14];
    for (let n = 0; n < positions.length; n++) {
      const at = positions[n]!;
      lead.push({ tick:bar*16+at, pitch:root+24+motif[(n + (bar % 2)) % motif.length]!,
        durationTicks:(positions[n+1] ?? 16)-at, velocity:section === 2 ? 0.72 : 0.84 });
    }
    for (let n=0;n<4;n++) bass.push({tick:bar*16+n*4,pitch:root+(n===3?7:0),durationTicks:4,velocity:0.75});
    for (let n=0;n<8;n++) perc.push({tick:bar*16+n*2,pitch:n===0?36:n===4?53:65,durationTicks:1,velocity:n%4===0?0.6:0.3});
    for (const pitch of chord) pad.push({tick:bar*16,pitch,durationTicks:16,velocity:0.3});
  }
  return {bpm:[116,128,108,140][stage] ?? 116,ticksPerBeat:4,beatsPerBar:4,
    tracks:[{role:'lead',notes:lead},{role:'bass',notes:bass},{role:'perc',notes:perc},{role:'pad',notes:pad}]};
}
export const JOURNEY_SCORES = [0,1,2,3].map(journeyScore);
