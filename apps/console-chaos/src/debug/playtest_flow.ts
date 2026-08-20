import { puzzleDisplayLabel } from '@/gameplay/puzzles/catalog';
import {
  createGameFlow,
  type ClearScreenModel,
  type GameFlow,
  type RunMode,
} from '@/ui/game_flow';
import type { PlaytestLog } from './playtest_log';

/** 記録を退避する間隔（ミリ秒）。落ちても直近の状態は残る。 */
export const KEEP_INTERVAL_MS = 10_000;

export interface PlaytestFlowOptions {
  log: PlaytestLog;
  isCleared: () => boolean;
  onStart: () => void;
  onRestart: () => void;
  onDemoStart?: () => boolean;
  onReturnTitle?: () => void;
  host?: HTMLElement;
  tester?: string | undefined;
}

export interface PlaytestFlow {
  readonly mode: RunMode;
  readonly started: boolean;
  readonly finished: boolean;
  update(): void;
  finish(): void;
  returnToTitle(): void;
  dispose(): void;
}

export function createPlaytestFlow(options: PlaytestFlowOptions): PlaytestFlow {
  if (options.tester) options.log.setTester(options.tester);
  let lastKeptMs = 0;
  const gameFlow: GameFlow = createGameFlow({
    ...(options.host ? { host: options.host } : {}),
    isCleared: options.isCleared,
    onManualStart(): void {
      lastKeptMs = performance.now();
      options.onStart();
    },
    onManualRestart(): void {
      lastKeptMs = performance.now();
      options.onRestart();
    },
    onManualFinish(cleared): void {
      if (cleared) options.log.markCleared();
      options.log.keep();
    },
    ...(options.onDemoStart ? { onDemoStart: options.onDemoStart } : {}),
    ...(options.onReturnTitle ? { onReturnTitle: options.onReturnTitle } : {}),
    clearModel(): ClearScreenModel {
      const record = options.log.record();
      return {
        title: record.cleared ? 'おしまい' : 'ここまでにします',
        body:
          `${Math.round(record.elapsedSeconds / 60)} 分 / 解けた仕掛け ${record.solvedCount} / ${record.puzzles.length}` +
          '　— 進行役にお知らせください',
        questions: record.puzzles.map(({ puzzleId }) => ({
          puzzleId,
          label: puzzleDisplayLabel(puzzleId),
        })),
      };
    },
    onExplained(puzzleId, value): void {
      options.log.setExplained(puzzleId, value);
      options.log.keep();
    },
    onSave: () => options.log.save(),
  });

  return {
    get mode() {
      return gameFlow.mode;
    },
    get started() {
      return gameFlow.mode !== 'title';
    },
    get finished() {
      return gameFlow.mode === 'clear';
    },
    update(): void {
      gameFlow.update();
      if (gameFlow.mode !== 'manual') return;
      const now = performance.now();
      if (now - lastKeptMs >= KEEP_INTERVAL_MS) {
        lastKeptMs = now;
        options.log.keep();
      }
    },
    finish: () => gameFlow.finishManual(),
    returnToTitle: () => gameFlow.returnToTitle(),
    dispose: () => gameFlow.dispose(),
  };
}
