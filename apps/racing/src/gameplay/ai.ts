import type { RaceTrack } from '../content/track';
import { sampleTrack } from '../content/track';
import type { CarControls, CarState } from './car';

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function controlsForAi(car: CarState, track: RaceTrack): CarControls {
  const sample = sampleTrack(track, car.position);
  const targetHeading = Math.atan2(sample.tangent[1], sample.tangent[0]);
  const error = wrapAngle(targetHeading - car.heading);
  const steer = Math.min(Math.max(error * 1.8, -1), 1);
  const accelerate = Math.abs(error) > 0.8 ? 0.42 : Math.abs(error) > 0.4 ? 0.72 : 0.92;
  return { steer, accelerate, brake: Math.abs(error) > 1.25 ? 0.35 : 0 };
}
