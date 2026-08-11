import type { RaceTrack } from '../content/track';
import { CIRCUIT } from '../content/track';
import { controlsForAi } from './ai';
import { createCar, resetCar, updateCar, type CarControls, type CarState } from './car';
import { createLapState, updateLap, type LapState } from './lap';

export const COUNTDOWN_TICKS = 180;
export const RACE_LAPS = 3;

export type RacePhase = 'countdown' | 'racing' | 'finished';
export type RaceEvent = 'countdown' | 'start' | 'lap' | 'finish';

export interface RacerState {
  id: 'player' | 'ai-1';
  car: CarState;
  laps: LapState;
  finishedAtTick: number | null;
}

export interface RaceState {
  readonly track: RaceTrack;
  phase: RacePhase;
  countdownTicks: number;
  tick: number;
  player: RacerState;
  opponents: RacerState[];
  rank: number;
  resultTime: number | null;
}

function createRacer(id: RacerState['id'], lateralOffset: number): RacerState {
  const position: [number, number] = [CIRCUIT.start[0] + lateralOffset, CIRCUIT.start[1] + lateralOffset * 0.25];
  return { id, car: createCar(position, CIRCUIT.startHeading), laps: createLapState(), finishedAtTick: null };
}

export function createRaceState(track: RaceTrack = CIRCUIT): RaceState {
  return {
    track,
    phase: 'countdown',
    countdownTicks: COUNTDOWN_TICKS,
    tick: 0,
    player: createRacer('player', 0),
    opponents: [createRacer('ai-1', 1.5)],
    rank: 1,
    resultTime: null,
  };
}

export function restartRace(state: RaceState): void {
  const fresh = createRaceState(state.track);
  state.phase = fresh.phase;
  state.countdownTicks = fresh.countdownTicks;
  state.tick = fresh.tick;
  state.player = fresh.player;
  state.opponents = fresh.opponents;
  state.rank = fresh.rank;
  state.resultTime = fresh.resultTime;
}

function updateRank(state: RaceState): void {
  const progressOf = (racer: RacerState): number => racer.finishedAtTick === null
    ? racer.laps.totalProgress
    : RACE_LAPS + Math.max(0, 1_000_000 - racer.finishedAtTick) / 1_000_000;
  state.rank = [state.player, ...state.opponents]
    .sort((left, right) => progressOf(right) - progressOf(left))
    .findIndex((racer) => racer.id === 'player') + 1;
}

export function updateRace(state: RaceState, controls: CarControls, resetRequested = false): RaceEvent[] {
  if (resetRequested) {
    restartRace(state);
    return [];
  }

  const events: RaceEvent[] = [];
  state.tick++;
  if (state.phase === 'countdown') {
    state.countdownTicks--;
    if (state.countdownTicks > 0 && state.countdownTicks % 60 === 0) events.push('countdown');
    if (state.countdownTicks <= 0) {
      state.phase = 'racing';
      events.push('start');
    }
    return events;
  }
  if (state.phase === 'finished') return events;

  updateCar(state.player.car, controls, state.track, 1 / 60);
  if (state.player.car.offTrackTicks > 180) resetCar(state.player.car);
  if (updateLap(state.player.laps, state.player.car, state.track, state.tick)) {
    events.push('lap');
    if (state.player.laps.lap >= RACE_LAPS) {
      state.player.finishedAtTick = state.tick;
      state.phase = 'finished';
      state.resultTime = (state.tick - COUNTDOWN_TICKS) / 60;
      events.push('finish');
    }
  }

  for (const opponent of state.opponents) {
    if (opponent.finishedAtTick !== null) continue;
    updateCar(opponent.car, controlsForAi(opponent.car, state.track), state.track, 1 / 60);
    if (opponent.car.offTrackTicks > 180) resetCar(opponent.car);
    if (updateLap(opponent.laps, opponent.car, state.track, state.tick) && opponent.laps.lap >= RACE_LAPS) {
      opponent.finishedAtTick = state.tick;
    }
  }
  updateRank(state);
  return events;
}

