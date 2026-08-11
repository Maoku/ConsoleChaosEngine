import type { RaceTrack } from '../content/track';
import type { CarState } from './car';
import { sampleTrack } from '../content/track';

export interface LapState {
  lap: number;
  nextCheckpoint: number;
  progress: number;
  totalProgress: number;
  lapStartedTick: number;
  lapTimes: number[];
}

export function createLapState(): LapState {
  return { lap: 0, nextCheckpoint: 1, progress: 0, totalProgress: 0, lapStartedTick: 0, lapTimes: [] };
}

function near(left: readonly [number, number], right: readonly [number, number], radius = 4.8): boolean {
  return Math.hypot(left[0] - right[0], left[1] - right[1]) <= radius;
}

export function updateLap(state: LapState, car: CarState, track: RaceTrack, tick: number): boolean {
  const sample = sampleTrack(track, car.position);
  state.progress = sample.progress;
  state.totalProgress = state.lap + sample.progress;
  const checkpoint = track.checkpoints[state.nextCheckpoint];
  if (!checkpoint || !near(car.position, checkpoint)) return false;
  const forward = Math.cos(car.heading) * sample.tangent[0] + Math.sin(car.heading) * sample.tangent[1];
  if (car.speed <= 0 || forward <= 0.25) return false;

  if (state.nextCheckpoint === 0) {
    state.lap++;
    state.lapTimes.push((tick - state.lapStartedTick) / 60);
    state.lapStartedTick = tick;
    state.nextCheckpoint = 1;
    state.totalProgress = state.lap;
    return true;
  }
  state.nextCheckpoint = (state.nextCheckpoint + 1) % track.checkpoints.length;
  return false;
}

