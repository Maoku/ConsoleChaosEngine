import type { StageFile } from '@/content/stage-schema';
import { stageLevel } from '@/content/stage-schema';
import { createStageRuntime } from './puzzles/stage-instances';
import { createSession, DEFAULT_SEED, type SessionOptions, type Session } from './session';

export function createStageSession(stage: StageFile, options: Omit<SessionOptions, 'level' | 'runtime'>): Session {
  return createSession({
    ...options,
    level: stageLevel(stage),
    runtime: createStageRuntime(stage, options.seed ?? DEFAULT_SEED),
    hints: { delaysMs: [55_000, 50_000, 45_000], ...options.hints },
  });
}
