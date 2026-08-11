import { pitchToFrequency, type HardwareGenerationProfile, type PlayRequest } from '@console-chaos/engine';
import type { RaceEvent } from '../../gameplay/race';

const CUE_PITCHES: Record<RaceEvent, readonly number[]> = {
  countdown: [69],
  start: [72, 79, 84],
  lap: [76, 81, 88],
  finish: [72, 79, 84, 91],
};

export function racingCueRequests(
  event: RaceEvent,
  profile: HardwareGenerationProfile,
  when: number,
): PlayRequest[] {
  const maximumLayers = profile.audio.channels < 8 ? 1 : profile.audio.channels < 24 ? 2 : CUE_PITCHES[event].length;
  const duration = event === 'finish' ? 0.36 : event === 'start' ? 0.2 : 0.12;
  return CUE_PITCHES[event].slice(0, maximumLayers).map((pitch, index) => ({
    role: 'fx',
    frequency: pitchToFrequency(pitch),
    when: when + index * 0.035,
    durationSeconds: duration * (profile.audio.reverb ? 1.2 : 1),
    velocity: (event === 'finish' ? 0.82 : 0.62) / (1 + index * 0.25),
    ...(profile.audio.positional ? { pan: 0 } : {}),
  }));
}
