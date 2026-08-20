import { TICK_SECONDS, type GenerationId } from '@console-chaos/engine';
import {
  CONSOLE_CHAOS_GENERATION_THEMES,
  type ForwardXZ,
} from '@/config/generation';
import {
  createNeutralConsoleChaosActions,
  type ConsoleChaosActionSnapshot,
} from '@/config/actions';
import { startNewRun } from '@/gameplay/run';
import type { Session } from '@/gameplay/session';
import type { LevelEntity, LevelFile } from '@/level/schema';

export const DEMO_SWITCH_TICKS = Math.round(5 / TICK_SECONDS);
export const DEMO_TOUR_TICKS = DEMO_SWITCH_TICKS * 8;
export const DEMO_CROSSING_TIMEOUT_TICKS = Math.round(20 / TICK_SECONDS);

export const DEMO_SWITCH_SEQUENCE: readonly GenerationId[] = [
  'SFC', 'PS1', 'PS2', 'FC',
  'SFC', 'PS1', 'PS2', 'FC',
];

export type DemoPhase = 'idle' | 'tour' | 'crossing' | 'finished';

interface DemoAnchors {
  startFloor: LevelEntity & { collider: NonNullable<LevelEntity['collider']> };
  pedestal: LevelEntity;
}

function demoAnchors(level: LevelFile): DemoAnchors | null {
  if (level.id !== 'area1') return null;
  const startFloor = level.entities.find(({ id }) => id === 'start_floor_a');
  const pedestal = level.entities.find(({ id }) => id === 'f1_pedestal');
  if (!startFloor?.collider || !pedestal) return null;
  return { startFloor: startFloor as DemoAnchors['startFloor'], pedestal };
}

export function demoAnchorIssues(level: LevelFile): string[] {
  if (level.id !== 'area1') return [];
  const issues: string[] = [];
  const startFloor = level.entities.find(({ id }) => id === 'start_floor_a');
  if (!startFloor?.collider) issues.push('start_floor_a に collider が無い');
  if (!level.entities.some(({ id }) => id === 'f1_pedestal')) issues.push('f1_pedestal が無い');
  if (!level.puzzles.some(({ puzzleId }) => puzzleId === 'F-1')) issues.push('F-1 の配置が無い');
  return issues;
}

/** ワールド XZ の希望方向を、現在のカメラ相対 move 入力へ戻す。 */
export function worldDirectionToMove(
  world: readonly [number, number],
  forward: ForwardXZ,
): readonly [number, number] {
  const length = Math.hypot(world[0], world[1]);
  if (length < 1e-6) return [0, 0];
  const wx = world[0] / length;
  const wz = world[1] / length;
  const [fx, fz] = forward;
  return [wx * -fz + wz * fx, -(wx * fx + wz * fz)];
}

function moveActions(world: readonly [number, number], generation: GenerationId): ConsoleChaosActionSnapshot {
  return {
    ...createNeutralConsoleChaosActions(),
    move: worldDirectionToMove(world, CONSOLE_CHAOS_GENERATION_THEMES[generation].camera.forward),
  };
}

export interface DemoController {
  readonly active: boolean;
  readonly phase: DemoPhase;
  readonly tickIndex: number;
  readonly crossingTicks: number;
  start(session: Session): boolean;
  actions(session: Session): ConsoleChaosActionSnapshot;
  afterTick(session: Session): void;
  stop(): void;
}

/** area1 を通常の固定更新と物理だけで操作する決定的デモ。 */
export function createDemoController(level: LevelFile): DemoController {
  const anchors = demoAnchors(level);
  let phase: DemoPhase = 'idle';
  let tickIndex = 0;
  let switchIndex = 0;
  let crossingTicks = 0;
  let patrolTargetX = 0;
  let lastRespawnCount = 0;

  const stop = (): void => {
    phase = 'idle';
    tickIndex = 0;
    switchIndex = 0;
    crossingTicks = 0;
  };

  return {
    get active() {
      return phase === 'tour' || phase === 'crossing';
    },
    get phase() {
      return phase;
    },
    get tickIndex() {
      return tickIndex;
    },
    get crossingTicks() {
      return crossingTicks;
    },
    start(session): boolean {
      if (!anchors) return false;
      startNewRun(session);
      phase = 'tour';
      tickIndex = 0;
      switchIndex = 0;
      crossingTicks = 0;
      lastRespawnCount = session.checkpoints.respawnCount;
      const [centerX] = anchors.startFloor.transform.position;
      patrolTargetX = centerX + anchors.startFloor.collider.halfExtents[0]
        - session.player.halfExtents[0] - 0.5;
      return true;
    },
    actions(session): ConsoleChaosActionSnapshot {
      if (!anchors || (phase !== 'tour' && phase !== 'crossing')) {
        return createNeutralConsoleChaosActions();
      }
      if (phase === 'tour') {
        tickIndex++;
        if (tickIndex % DEMO_SWITCH_TICKS === 0) {
          const target = DEMO_SWITCH_SEQUENCE[switchIndex];
          if (target) session.generation.request(target);
          switchIndex++;
          if (switchIndex === DEMO_SWITCH_SEQUENCE.length) phase = 'crossing';
        }
      }

      if (phase === 'crossing') {
        crossingTicks++;
        const targetX = anchors.pedestal.transform.position[0];
        return moveActions([Math.sign(targetX - session.player.position[0]), 0], session.generation.generation);
      }

      const [centerX] = anchors.startFloor.transform.position;
      const halfX = anchors.startFloor.collider.halfExtents[0];
      const inset = session.player.halfExtents[0] + 0.5;
      const minX = centerX - halfX + inset;
      const maxX = centerX + halfX - inset;
      if (Math.abs(session.player.position[0] - patrolTargetX) < 0.2) {
        patrolTargetX = patrolTargetX === maxX ? minX : maxX;
      }
      return moveActions([Math.sign(patrolTargetX - session.player.position[0]), 0], session.generation.generation);
    },
    afterTick(session): void {
      if (phase !== 'crossing') return;
      if (session.checkpoints.respawnCount !== lastRespawnCount) {
        lastRespawnCount = session.checkpoints.respawnCount;
        session.generation.request('FC');
      }
      if (session.solved.has('F-1') || crossingTicks >= DEMO_CROSSING_TIMEOUT_TICKS) {
        phase = 'finished';
      }
    },
    stop,
  };
}
