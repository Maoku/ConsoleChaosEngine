import type { HardwareGenerationProfile, PlayRequest } from '@console-chaos/engine';

export interface VehicleAudioRacer {
  readonly speed: number;
  readonly distance: number;
  readonly pan: number;
}

export interface VehicleAudioFrame {
  readonly tick: number;
  readonly playerSpeed: number;
  readonly throttle: number;
  readonly brake: number;
  readonly opponents: readonly VehicleAudioRacer[];
}

export function vehicleFrequency(speed: number, profile: HardwareGenerationProfile): number {
  const normalized = Math.min(Math.abs(speed) / 25, 1);
  const raw = 82 + normalized * (profile.audio.sampleRate === 0 ? 190 : 270);
  return profile.audio.sampleRate === 0 ? Math.round(raw / 12.5) * 12.5 : raw;
}

export interface VehicleSoundScheduler {
  update(frame: VehicleAudioFrame, profile: HardwareGenerationProfile, currentTime: number): PlayRequest[];
  reset(): void;
}

export function createVehicleSoundScheduler(): VehicleSoundScheduler {
  let braking = false;
  return {
    update(frame, profile, currentTime): PlayRequest[] {
      const requests: PlayRequest[] = [];
      if (frame.tick % 5 === 0) {
        const speedRatio = Math.min(Math.abs(frame.playerSpeed) / 25, 1);
        requests.push({
          role: 'fx',
          frequency: vehicleFrequency(frame.playerSpeed, profile),
          when: currentTime + 0.01,
          durationSeconds: 0.095,
          velocity: 0.12 + speedRatio * 0.1 + Math.min(Math.max(frame.throttle, 0), 1) * 0.08,
          ...(profile.audio.positional ? { pan: 0 } : {}),
        });
      }
      if (frame.tick % 10 === 0) {
        for (const opponent of frame.opponents) {
          if (opponent.distance >= 30) continue;
          const attenuation = Math.max(0, 1 - opponent.distance / 30);
          requests.push({
            role: 'fx',
            frequency: vehicleFrequency(opponent.speed, profile) * 0.94,
            when: currentTime + 0.012,
            durationSeconds: 0.09,
            velocity: 0.1 * attenuation,
            ...(profile.audio.positional ? { pan: Math.min(Math.max(opponent.pan, -1), 1) } : {}),
          });
        }
      }
      const shouldStartBrake = !braking && frame.brake >= 0.6 && Math.abs(frame.playerSpeed) >= 8;
      if (shouldStartBrake) {
        braking = true;
        requests.push({
          role: 'fx',
          frequency: profile.audio.sampleRate === 0 ? 112.5 : 146,
          when: currentTime + 0.01,
          durationSeconds: profile.audio.reverb ? 0.18 : 0.13,
          velocity: 0.42,
          ...(profile.audio.positional ? { pan: 0 } : {}),
        });
      }
      if (braking && (frame.brake <= 0.25 || Math.abs(frame.playerSpeed) <= 5)) braking = false;
      return requests;
    },
    reset(): void {
      braking = false;
    },
  };
}
