import { describe, expect, it } from 'vitest';
import { CIRCUIT, sampleTrack } from '@racing/content/track';
import { createCar, updateCar } from '@racing/gameplay/car';
import { controlsForAi } from '@racing/gameplay/ai';
import { createLapState, updateLap } from '@racing/gameplay/lap';

function replay(ticks: number) {
  const car = createCar(CIRCUIT.start, CIRCUIT.startHeading);
  for (let tick = 0; tick < ticks; tick++) {
    const controls = tick < 240
      ? { steer: tick > 130 ? 0.35 : 0, accelerate: 1, brake: 0 }
      : controlsForAi(car, CIRCUIT);
    updateCar(car, controls, CIRCUIT, 1 / 60);
  }
  return car;
}

describe('kinematic car', () => {
  it('is deterministic for a fixed input replay', () => {
    expect(replay(1800)).toEqual(replay(1800));
  });

  it('keeps the vehicle within the collision edge and slows off-track', () => {
    const car = createCar([0, 0], 0);
    car.position = [100, 100];
    car.speed = 20;
    updateCar(car, { steer: 0, accelerate: 1, brake: 0 }, CIRCUIT, 1 / 60);
    expect(sampleTrack(CIRCUIT, car.position).distance).toBeLessThanOrEqual(CIRCUIT.halfWidth + 1e-8);
    expect(car.speed).toBeLessThan(20.3);
  });

  it('lets the deterministic path-following AI complete three laps', () => {
    const car = createCar(CIRCUIT.start, CIRCUIT.startHeading);
    const laps = createLapState();
    for (let tick = 0; tick < 36_000 && laps.lap < 3; tick++) {
      updateCar(car, controlsForAi(car, CIRCUIT), CIRCUIT, 1 / 60);
      updateLap(laps, car, CIRCUIT, tick);
    }
    expect(laps.lap).toBe(3);
  });
});
