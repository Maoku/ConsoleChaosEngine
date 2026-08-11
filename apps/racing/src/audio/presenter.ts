import type { AudioService, HardwareGenerationProfile, Score } from '@console-chaos/engine';

export interface RacingAudioPresenter {
  start(profile: HardwareGenerationProfile, fromTick?: number): void;
  applyGeneration(profile: HardwareGenerationProfile): void;
}

export function createRacingAudioPresenter(audio: AudioService, score: Score): RacingAudioPresenter {
  return {
    start(_profile, fromTick = 0): void {
      audio.playScore(score, fromTick);
    },
    applyGeneration(_profile): void {
      audio.useScore(score);
    },
  };
}
