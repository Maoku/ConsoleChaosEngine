import type { AudioService, HardwareGenerationProfile } from '@console-chaos/engine';
import { composeLegacyGenerationProfile } from '@/config/generation';
import { arrangeFor } from './music';
import { sfxRequests, type SfxId, type SfxOptions } from './sfx';
import type { Score } from './score';

export interface ConsoleAudioPresenter {
  start(hardware: HardwareGenerationProfile, fromTick?: number): void;
  applyGeneration(hardware: HardwareGenerationProfile): void;
  playSfx(id: SfxId, hardware: HardwareGenerationProfile, options?: SfxOptions): void;
  changeSong(score: Score): void;
}

export function createConsoleAudioPresenter(audio: AudioService, initialSong: Score): ConsoleAudioPresenter {
  let song = initialSong;
  const arrangements = new Map<string, Score>();
  const arrangement = (hardware: HardwareGenerationProfile): Score => {
    let score = arrangements.get(hardware.id);
    if (!score) {
      score = arrangeFor(composeLegacyGenerationProfile(hardware.id), song);
      arrangements.set(hardware.id, score);
    }
    return score;
  };
  return {
    start(hardware, fromTick = 0): void {
      audio.setGenerationProfile(hardware);
      audio.playScore(arrangement(hardware), fromTick);
    },
    applyGeneration(hardware): void {
      audio.setGenerationProfile(hardware);
      audio.useScore(arrangement(hardware));
    },
    playSfx(id, hardware, options): void {
      for (const request of sfxRequests(id, composeLegacyGenerationProfile(hardware.id), audio.currentTime + 0.01, options)) {
        audio.playOneShot(request);
      }
    },
    changeSong(next): void {
      song = next;
      arrangements.clear();
    },
  };
}
