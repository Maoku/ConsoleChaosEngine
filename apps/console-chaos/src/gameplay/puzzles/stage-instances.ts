import { hash32, type Entity } from '@console-chaos/engine';
import type { StageFile, StagePuzzle } from '@/content/stage-schema';
import { stageCompletionIn } from '@/content/stage-capabilities';
import { createStageProgress, type StageProgress } from '../stage-progress';
import { getPuzzle } from './registry';
import type { PuzzleContext, PuzzleDefinition } from './types';
import { updateFlickerPath } from './flicker-path';

const LEGACY_ROLES: Record<StagePuzzle['kind'], Record<string, string>> = {
  'F-1': { braid: 'f1_braid', vineA: 'f1_vine_a', vineB: 'f1_vine_b', terminal: 'f1_pedestal' },
  'F-2': { tiles: 'f2_tile_', lamps: 'f2_lamp_', swarm: 'f2_swarm_', terminal: 'f2_pedestal' },
  'S-1': { pivot: 's1_pivot', island: 's1_island', step: 's1_platform', terminal: 's1_pedestal' },
  'P1-1': { wall: 'p1_1_wall', terminal: 'p1_1_switch' },
  'P1-2': { seam: 'p1_2_seam', terminal: 'p1_2_core' },
  'P2-1': { slabs: 'p2_1_slab_', terminal: 'p2_1_mark' },
};
export interface StageRuntime {
  readonly stage: StageFile;
  readonly progress: StageProgress;
  readonly definitions: readonly PuzzleDefinition[];
  scope(id: string, entities: ReadonlyMap<string, Entity>): ReadonlyMap<string, Entity>;
  seed(id: string): number;
  canClear(goal: string): boolean;
}

export function stableIdSeed(seed: number, id: string): number {
  for (const code of id) seed = hash32(seed, code.codePointAt(0)!);
  return seed;
}

/** Reuse the legacy families through isolated bindings, without exposing sibling entities. */
export function createStageRuntime(stage: StageFile, seed: number): StageRuntime {
  const progress = createStageProgress(stage.instances.map((instance) => instance.achievement));
  const byId = new Map(stage.instances.map((instance) => [instance.id, instance]));
  const definitions = stage.instances.map((instance): PuzzleDefinition => {
    const definition = getPuzzle(instance.kind);
    if (!definition) throw new Error('未知のパズル: ' + instance.kind);
    return {
      ...definition,
      id: instance.id,
      solvableIn: (profile) => stageCompletionIn(instance, profile.hardware),
      update(ctx: PuzzleContext) {
        const scoped: PuzzleContext = {
          ...ctx,
          markSolved() {
            if (ctx.initializing) return;
            if (instance.variant === 'connection' && instance.kind === 'F-1' && ctx.profile.hardware.video.paletteMode !== 'fixed54') return;
            if (progress.grant(instance.achievement)) ctx.markSolved();
          },
        };
        if (instance.kind === 'F-2') {
          updateFlickerPath(scoped, (instance.bindings.tiles as string[]).length,
            instance.settings.safeCount!, (instance.bindings.swarm as string[]).length);
        } else definition.update(scoped);
      },
    };
  });
  return {
    stage, progress, definitions,
    scope(id, entities) {
      const instance = byId.get(id)!;
      const aliases = new Map<string, Entity>();
      for (const [role, refs] of Object.entries(instance.bindings)) {
        const prefix = LEGACY_ROLES[instance.kind][role]!;
        for (const [index, ref] of (Array.isArray(refs) ? refs : [refs]).entries()) {
          const entity = entities.get(ref);
          if (entity === undefined) throw new Error('roleが実体化されていない: ' + ref);
          aliases.set(Array.isArray(refs) ? prefix + (index + 1) : prefix, entity);
        }
      }
      return aliases;
    },
    seed: (id) => stableIdSeed(seed, stage.id + ':' + id),
    canClear: (goal) => goal === stage.exit.goal && progress.satisfies(stage.exit.requires),
  };
}
