import type { RaceTrack } from '../content/track';
import { sampleTrack } from '../content/track';

export interface CarControls {
  steer: number;
  accelerate: number;
  brake: number;
}

export interface CarState {
  position: [number, number];
  heading: number;
  speed: number;
  lastSafePosition: [number, number];
  lastSafeHeading: number;
  offTrackTicks: number;
}

export const MAX_FORWARD_SPEED = 25;
export const MAX_REVERSE_SPEED = -6;
const ACCELERATION = 16;
const BRAKING = 24;
const ROLLING_DRAG = 2.2;
const TURN_RATE = 2.15;

export function createCar(position: readonly [number, number], heading: number): CarState {
  return {
    position: [...position],
    heading,
    speed: 0,
    lastSafePosition: [...position],
    lastSafeHeading: heading,
    offTrackTicks: 0,
  };
}

export function resetCar(car: CarState): void {
  car.position = [...car.lastSafePosition];
  car.heading = car.lastSafeHeading;
  car.speed = 0;
  car.offTrackTicks = 0;
}

export function updateCar(car: CarState, controls: CarControls, track: RaceTrack, dtSeconds: number): void {
  const throttle = Math.min(Math.max(controls.accelerate, 0), 1);
  const brake = Math.min(Math.max(controls.brake, 0), 1);
  const drive = throttle * ACCELERATION - brake * BRAKING;
  const drag = Math.min(Math.abs(car.speed), ROLLING_DRAG * dtSeconds) * Math.sign(car.speed);
  car.speed = Math.min(Math.max(car.speed + drive * dtSeconds - drag, MAX_REVERSE_SPEED), MAX_FORWARD_SPEED);
  if (brake > 0.1 && Math.abs(car.speed) < 0.5 && throttle === 0) car.speed = Math.max(car.speed - 6 * dtSeconds, MAX_REVERSE_SPEED);

  const speedRatio = Math.min(Math.abs(car.speed) / 8, 1);
  car.heading += Math.min(Math.max(controls.steer, -1), 1) * TURN_RATE * speedRatio * Math.sign(car.speed || 1) * dtSeconds;
  car.position[0] += Math.cos(car.heading) * car.speed * dtSeconds;
  car.position[1] += Math.sin(car.heading) * car.speed * dtSeconds;

  const sample = sampleTrack(track, car.position);
  if (sample.distance <= track.halfWidth * 0.72) {
    car.lastSafePosition = [...car.position];
    car.lastSafeHeading = car.heading;
    car.offTrackTicks = 0;
    return;
  }

  car.offTrackTicks++;
  car.speed *= Math.max(0, 1 - 2.6 * dtSeconds);
  if (sample.distance > track.halfWidth) {
    const dx = car.position[0] - sample.point[0];
    const dz = car.position[1] - sample.point[1];
    const length = Math.hypot(dx, dz) || 1;
    car.position[0] = sample.point[0] + dx / length * track.halfWidth;
    car.position[1] = sample.point[1] + dz / length * track.halfWidth;
  }
}

