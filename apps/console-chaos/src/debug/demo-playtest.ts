import type { DeviceSnapshot } from '@console-chaos/engine';
import type { Session } from '@/gameplay/session';
import { stageOf } from '@/gameplay/hints';

export interface DemoPlaytestStage {
  stageId: string;
  elapsedSeconds: number;
  idleSeconds: number;
  falls: number;
  switches: number;
  cleared: boolean;
  resumedAchievements: string[];
  instances: Array<{ id: string; kind: string; achievement: string; solvedAtSeconds: number | null; hintStage: number }>;
  events: Array<{ seconds: number; kind: 'checkpoint' | 'achievement' | 'hint' | 'switch' | 'fall' | 'exit'; target: string }>;
}
export function createDemoPlaytest() {
  const stages: DemoPlaytestStage[] = [];
  let session: Session | null = null;
  let current: DemoPlaytestStage | null = null;
  let elapsedTicks = 0;
  let previousGeneration = '';
  let previousCheckpoint = '';
  let previousFalls = 0;
  let previousPosition = [0, 0, 0];
  let keyboard = false, gamepad = false;
  return {
    reset(): void { stages.length = 0; session = null; current = null; keyboard = false; gamepad = false; },
    update(next: Session, input: DeviceSnapshot): void {
      if (!next.runtime) return;
      if (session !== next) {
        session = next; elapsedTicks = 0;
        previousGeneration = next.generation.generation;
        previousCheckpoint = next.snapshot().checkpointId ?? '';
        previousFalls = next.checkpoints.respawnCount;
        previousPosition = [...next.player.position];
        current = { stageId: next.level.id, elapsedSeconds: 0, idleSeconds: 0, falls: 0, switches: 0, cleared: false,
          resumedAchievements: [...next.runtime.progress.completed],
          instances: next.runtime.stage.instances.map((p) => ({ id: p.id, kind: p.kind, achievement: p.achievement,
            solvedAtSeconds: next.solved.has(p.id) ? 0 : null, hintStage: 0 })), events: [] };
        stages.push(current);
      }
      const stage = current!;
      elapsedTicks++; stage.elapsedSeconds = elapsedTicks / 60;
      const event = (kind: DemoPlaytestStage['events'][number]['kind'], target: string) => stage.events.push({ seconds: stage.elapsedSeconds, kind, target });
      keyboard ||= input.keys.size > 0;
      gamepad ||= [...input.gamepadButtons.values()].some((v) => v > 0.25) || input.gamepadAxes.some((v) => Math.abs(v) > 0.25);
      if (Math.hypot(...next.player.position.map((v, i) => v - previousPosition[i]!)) < 0.005) stage.idleSeconds += 1 / 60;
      previousPosition = [...next.player.position];
      if (previousGeneration !== next.generation.generation) { stage.switches++; event('switch', next.generation.generation); previousGeneration = next.generation.generation; }
      const checkpoint = next.snapshot().checkpointId ?? '';
      if (checkpoint !== previousCheckpoint) { event('checkpoint', checkpoint); previousCheckpoint = checkpoint; }
      if (next.checkpoints.respawnCount !== previousFalls) { stage.falls += next.checkpoints.respawnCount - previousFalls; event('fall', checkpoint); previousFalls = next.checkpoints.respawnCount; }
      for (const instance of stage.instances) {
        if (instance.solvedAtSeconds === null && next.solved.has(instance.id)) { instance.solvedAtSeconds = stage.elapsedSeconds; event('achievement', instance.achievement); }
        const hint = stageOf(next.hints, instance.id);
        if (hint > instance.hintStage) { instance.hintStage = hint; event('hint', instance.id + ':' + hint); }
      }
      if (!stage.cleared && next.cleared) { stage.cleared = true; event('exit', next.level.id); }
    },
    record() { return { version: 1, device: keyboard && gamepad ? 'mixed' : keyboard ? 'keyboard' : gamepad ? 'gamepad' : 'unknown',
      elapsedSeconds: stages.reduce((sum, stage) => sum + stage.elapsedSeconds, 0), stages: structuredClone(stages) }; },
  };
}
export function downloadDemoPlaytest(record: ReturnType<ReturnType<typeof createDemoPlaytest>['record']>): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'console-chaos-four-stage-playtest.json'; link.click(); URL.revokeObjectURL(url);
}
