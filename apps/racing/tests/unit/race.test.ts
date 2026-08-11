import { describe, expect, it } from 'vitest';
import { createRaceState, updateRace, COUNTDOWN_TICKS } from '@racing/gameplay/race';
import { CIRCUIT, sampleTrack } from '@racing/content/track';

function simulate(ticks: number) {
  const race = createRaceState();
  for (let tick = 0; tick < ticks; tick++) {
    updateRace(race, { steer: Math.sin(tick / 180) * 0.35, accelerate: 1, brake: 0 });
  }
  return {
    phase: race.phase,
    tick: race.tick,
    player: race.player.car,
    playerLap: race.player.laps,
    opponent: race.opponents[0],
    rank: race.rank,
  };
}

describe('race state', () => {
  it('runs a deterministic countdown and simulation', () => {
    const first = simulate(2400);
    const second = simulate(2400);
    expect(first).toEqual(second);
    expect(first.tick).toBe(2400);
  });

  it('starts after exactly three seconds and restarts from any state', () => {
    const race = createRaceState();
    for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) updateRace(race, { steer: 0, accelerate: 1, brake: 0 });
    expect(race.phase).toBe('racing');
    updateRace(race, { steer: 0, accelerate: 0, brake: 0 }, true);
    expect(race.phase).toBe('countdown');
    expect(race.tick).toBe(0);
  });

  it('finishes after three ordered laps, shows a result, and restarts', () => {
    const race = createRaceState();
    race.phase = 'racing';
    race.countdownTicks = 0;
    for (let lap = 0; lap < 3; lap++) {
      for (const checkpointIndex of [1, 2, 3, 0]) {
        const point = CIRCUIT.checkpoints[checkpointIndex] ?? CIRCUIT.start;
        const tangent = sampleTrack(CIRCUIT, point).tangent;
        race.player.car.position = [...point];
        race.player.car.heading = Math.atan2(tangent[1], tangent[0]);
        race.player.car.speed = 8;
        updateRace(race, { steer: 0, accelerate: 0, brake: 0 });
      }
    }
    expect(race.phase).toBe('finished');
    expect(race.player.laps.lap).toBe(3);
    expect(race.resultTime).not.toBeNull();
    updateRace(race, { steer: 0, accelerate: 0, brake: 0 }, true);
    expect(race.phase).toBe('countdown');
  });
});
