import type { Vec2 } from '@console-chaos/engine';
import { MAX_FORWARD_SPEED } from '../gameplay/car';
import type { RacerState, RaceState } from '../gameplay/race';

const TAU = Math.PI * 2;

export interface RaceVisualRacer {
  readonly id: RacerState['id'];
  readonly position: Vec2;
  readonly heading: number;
  readonly speed: number;
  readonly normalizedRpm: number;
  readonly courseProgress: number;
  readonly trackLateralOffset: number;
  readonly distanceFromPlayer: number;
  readonly forwardDistance: number;
  readonly lateralDistance: number;
  readonly relativeHeading: number;
}

export interface RaceVisualState {
  readonly tick: number;
  readonly timeSeconds: number;
  readonly animationTime: number;
  readonly phase: RaceState['phase'];
  readonly lap: number;
  readonly rank: number;
  readonly nextCheckpoint: number;
  readonly raceTimeSeconds: number;
  readonly curveAhead: number;
  readonly headingError: number;
  readonly offTrackRatio: number;
  readonly player: RaceVisualRacer;
  readonly opponents: readonly RaceVisualRacer[];
}

interface ProgressSample {
  readonly point: Vec2;
  readonly tangent: Vec2;
}

function wrap01(value: number): number {
  return value - Math.floor(value);
}

function wrapAngle(value: number): number {
  let wrapped = (value + Math.PI) % TAU;
  if (wrapped < 0) wrapped += TAU;
  return wrapped - Math.PI;
}

function sampleAtProgress(state: RaceState, progress: number): ProgressSample {
  const points = state.track.points;
  const lengths = points.map((point, index) => {
    const next = points[(index + 1) % points.length] ?? point;
    return Math.hypot(next[0] - point[0], next[1] - point[1]);
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = wrap01(progress) * total;
  for (let index = 0; index < points.length; index++) {
    const start = points[index] ?? [0, 0];
    const end = points[(index + 1) % points.length] ?? start;
    const length = lengths[index] ?? 0;
    if (remaining <= length || index === points.length - 1) {
      const along = length === 0 ? 0 : remaining / length;
      return {
        point: [start[0] + (end[0] - start[0]) * along, start[1] + (end[1] - start[1]) * along],
        tangent: length === 0 ? [1, 0] : [(end[0] - start[0]) / length, (end[1] - start[1]) / length],
      };
    }
    remaining -= length;
  }
  return { point: points[0] ?? [0, 0], tangent: [1, 0] };
}

function projectRacer(state: RaceState, racer: RacerState, player: RacerState): RaceVisualRacer {
  const sample = state.track.points.length > 0
    ? sampleAtProgress(state, racer.laps.totalProgress % 1)
    : { point: [0, 0] as Vec2, tangent: [1, 0] as Vec2 };
  const dx = racer.car.position[0] - player.car.position[0];
  const dz = racer.car.position[1] - player.car.position[1];
  const forwardX = Math.cos(player.car.heading);
  const forwardZ = Math.sin(player.car.heading);
  const trackDx = racer.car.position[0] - sample.point[0];
  const trackDz = racer.car.position[1] - sample.point[1];
  return {
    id: racer.id,
    position: [racer.car.position[0], racer.car.position[1]],
    heading: racer.car.heading,
    speed: racer.car.speed,
    normalizedRpm: Math.min(Math.abs(racer.car.speed) / MAX_FORWARD_SPEED, 1),
    courseProgress: racer.laps.totalProgress,
    trackLateralOffset: -sample.tangent[1] * trackDx + sample.tangent[0] * trackDz,
    distanceFromPlayer: Math.hypot(dx, dz),
    forwardDistance: forwardX * dx + forwardZ * dz,
    lateralDistance: -forwardZ * dx + forwardX * dz,
    relativeHeading: wrapAngle(racer.car.heading - player.car.heading),
  };
}

export function createRaceVisualState(state: RaceState): RaceVisualState {
  const playerProgress = state.player.laps.totalProgress % 1;
  const here = sampleAtProgress(state, playerProgress);
  const ahead = sampleAtProgress(state, playerProgress + 0.075);
  const trackHeading = Math.atan2(here.tangent[1], here.tangent[0]);
  const aheadHeading = Math.atan2(ahead.tangent[1], ahead.tangent[0]);
  const player = projectRacer(state, state.player, state.player);
  return {
    tick: state.tick,
    timeSeconds: state.tick / 60,
    animationTime: state.tick / 60,
    phase: state.phase,
    lap: state.player.laps.lap,
    rank: state.rank,
    nextCheckpoint: state.player.laps.nextCheckpoint,
    raceTimeSeconds: Math.max(0, state.tick - 180) / 60,
    curveAhead: wrapAngle(aheadHeading - trackHeading),
    headingError: wrapAngle(state.player.car.heading - trackHeading),
    offTrackRatio: Math.min(Math.abs(player.trackLateralOffset) / state.track.halfWidth, 1),
    player,
    opponents: state.opponents.map((opponent) => projectRacer(state, opponent, state.player)),
  };
}
