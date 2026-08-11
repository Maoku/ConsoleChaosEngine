import { describe, expect, it } from 'vitest';
import { CIRCUIT, sampleTrack } from '@racing/content/track';
import { createCar } from '@racing/gameplay/car';
import { createLapState, updateLap } from '@racing/gameplay/lap';

function crossCheckpoint(index: number, lap: ReturnType<typeof createLapState>, tick: number, reverse = false): boolean {
  const point = CIRCUIT.checkpoints[index] ?? CIRCUIT.start;
  const car = createCar(point, 0);
  const tangent = sampleTrack(CIRCUIT, point).tangent;
  car.heading = Math.atan2(tangent[1], tangent[0]) + (reverse ? Math.PI : 0);
  car.speed = reverse ? -8 : 8;
  return updateLap(lap, car, CIRCUIT, tick);
}

describe('ordered lap checkpoints', () => {
  it('counts only a complete forward sequence', () => {
    const lap = createLapState();
    expect(crossCheckpoint(0, lap, 1)).toBe(false);
    expect(lap.lap).toBe(0);
    crossCheckpoint(1, lap, 60);
    crossCheckpoint(2, lap, 120);
    crossCheckpoint(3, lap, 180);
    expect(crossCheckpoint(0, lap, 240)).toBe(true);
    expect(lap.lap).toBe(1);
  });

  it('rejects reverse crossings and reaches three laps deterministically', () => {
    const lap = createLapState();
    expect(crossCheckpoint(1, lap, 10, true)).toBe(false);
    expect(lap.nextCheckpoint).toBe(1);
    let tick = 0;
    for (let lapIndex = 0; lapIndex < 3; lapIndex++) {
      for (const checkpoint of [1, 2, 3, 0]) crossCheckpoint(checkpoint, lap, tick += 60);
    }
    expect(lap.lap).toBe(3);
    expect(lap.lapTimes).toEqual([4, 4, 4]);
  });
});

