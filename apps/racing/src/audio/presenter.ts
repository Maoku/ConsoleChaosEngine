import type { AudioService, HardwareGenerationProfile, Score } from '@console-chaos/engine';
import type { RaceEvent, RaceState } from '../gameplay/race';
import { arrangeRacingScore } from '../content/audio/arrangements';
import { racingCueRequests } from '../content/audio/cues';
import { createVehicleSoundScheduler } from './vehicle-sound';

export interface RacingAudioControls {
  readonly throttle: number;
  readonly brake: number;
}

export interface RacingAudioPresenter {
  start(profile: HardwareGenerationProfile, fromTick?: number): void;
  applyGeneration(profile: HardwareGenerationProfile): void;
  playRaceEvents(events: readonly RaceEvent[], profile: HardwareGenerationProfile): void;
  updateVehicles(state: RaceState, controls: RacingAudioControls, profile: HardwareGenerationProfile): void;
  resetVehicleSound(): void;
}

export function createRacingAudioPresenter(audio: AudioService, score: Score): RacingAudioPresenter {
  const arrangements = new Map<HardwareGenerationProfile['id'], Score>();
  const vehicles = createVehicleSoundScheduler();
  const arrangement = (profile: HardwareGenerationProfile): Score => {
    let found = arrangements.get(profile.id);
    if (!found) {
      found = arrangeRacingScore(profile, score);
      arrangements.set(profile.id, found);
    }
    return found;
  };
  return {
    start(profile, fromTick = 0): void {
      audio.playScore(arrangement(profile), fromTick);
    },
    applyGeneration(profile): void {
      audio.useScore(arrangement(profile));
    },
    playRaceEvents(events, profile): void {
      for (const event of events) {
        for (const request of racingCueRequests(event, profile, audio.currentTime + 0.01)) {
          audio.playOneShot(request);
        }
      }
    },
    updateVehicles(state, controls, profile): void {
      const player = state.player.car;
      const rightX = -Math.sin(player.heading);
      const rightZ = Math.cos(player.heading);
      const requests = vehicles.update({
        tick: state.tick,
        playerSpeed: player.speed,
        throttle: controls.throttle,
        brake: controls.brake,
        opponents: state.opponents.map((opponent) => {
          const dx = opponent.car.position[0] - player.position[0];
          const dz = opponent.car.position[1] - player.position[1];
          return {
            speed: opponent.car.speed,
            distance: Math.hypot(dx, dz),
            pan: (rightX * dx + rightZ * dz) / 12,
          };
        }),
      }, profile, audio.currentTime);
      for (const request of requests) audio.playOneShot(request);
    },
    resetVehicleSound(): void {
      vehicles.reset();
    },
  };
}
