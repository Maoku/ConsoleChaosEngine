import type { AudioService, HardwareGenerationProfile } from '@console-chaos/engine';
import { arrangeFor } from './music';
import { sfxRequests, type SfxId, type SfxOptions } from './sfx';
import type { Score } from '@console-chaos/engine';

export interface ConsoleAudioPresenter {
  start(hardware: HardwareGenerationProfile, fromTick?: number): void;
  applyGeneration(hardware: HardwareGenerationProfile): void;
  playSfx(id: SfxId, hardware: HardwareGenerationProfile, options?: SfxOptions): void;
  changeSong(score: Score): void;
  setMuted(muted: boolean): void;
}

export function createConsoleAudioPresenter(audio: AudioService, initialSong: Score): ConsoleAudioPresenter {
  let song = initialSong;
  let hardware: HardwareGenerationProfile | null = null;
  const arrangements = new Map<string, Score>();
  const arrangement = (hardware: HardwareGenerationProfile): Score => {
    let score = arrangements.get(hardware.id);
    if (!score) {
      score = arrangeFor(hardware, song);
      arrangements.set(hardware.id, score);
    }
    return score;
  };
  return {
    start(profile, fromTick = 0): void {
      hardware = profile;
      audio.playScore(arrangement(profile), fromTick);
    },
    applyGeneration(profile): void {
      hardware = profile;
      audio.useScore(arrangement(profile));
    },
    playSfx(id, hardware, options): void {
      for (const request of sfxRequests(id, hardware, audio.currentTime + 0.01, options)) {
        audio.playOneShot(request);
      }
    },
    changeSong(next): void {
      if (next === song) return;
      song = next;
      arrangements.clear();
      if (hardware) audio.playScore(arrangement(hardware), 0);
    },
    setMuted(value): void {
      audio.setMuted(value);
    },
  };
}
