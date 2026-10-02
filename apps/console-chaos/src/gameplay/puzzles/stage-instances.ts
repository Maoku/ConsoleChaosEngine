import { hash32, type Entity } from '@console-chaos/engine';
import type { GardenSafety } from '../stage-snapshot';
import type { StageFile, StagePuzzle } from '@/content/stage-schema';
import { stageCompletionIn } from '@/content/stage-capabilities';
import { createStageProgress, type StageProgress } from '../stage-progress';
import { getPuzzle } from './registry';
import type { PuzzleContext, PuzzleDefinition } from './types';
import { illuminateMark } from './illuminated-mark';
import { gardenState, moveGarden, connectGarden, type GardenState } from './affine-garden';
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
  readonly gardens: ReadonlyMap<string, GardenState>;
  checkpoint(): void;
  retry(): void;
  safety(): Record<string, GardenSafety>;
  restoreSafety(safety: Record<string, GardenSafety>): void;
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
  const gardens = new Map(stage.instances.filter((p) => p.kind === 'S-1').map((p) => [p.id, gardenState()]));
  let safeGardens = new Map<string, GardenState>();
  const byId = new Map(stage.instances.map((instance) => [instance.id, instance]));
  const definitions = stage.instances.map((instance): PuzzleDefinition => {
    const definition = getPuzzle(instance.kind);
    if (!definition) throw new Error('未知のパズル: ' + instance.kind);
    return {
      ...definition,
      id: instance.id,
      solvableIn: (profile) => stageCompletionIn(instance, profile.hardware),
      beforePhysics(ctx) {
        if (instance.kind === 'S-1') moveGarden(ctx, instance, gardens.get(instance.id)!);
      },
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
        } else if (instance.kind === 'S-1') {
          if (ctx.initializing) moveGarden(scoped, instance, gardens.get(instance.id)!);
          connectGarden(scoped, instance, gardens.get(instance.id)!);
        } else if (instance.kind === 'P2-1') illuminateMark(scoped, instance);
        else definition.update(scoped);
      },
    };
  });
  return {
    stage, progress, definitions, gardens,
    checkpoint() { safeGardens = new Map([...gardens].map(([id, state]) => [id, structuredClone(state)])); },
    retry() { for (const [id, state] of gardens) Object.assign(state, safeGardens.get(id) ?? gardenState()); },
    safety() { return Object.fromEntries([...safeGardens].map(([id, state]) => [id, { ticks: state.ticks, carriedTicks: state.carriedTicks }])); },
    restoreSafety(safety) {
      for (const [id, phase] of Object.entries(safety)) {
        if (!gardens.has(id) || !Number.isSafeInteger(phase.ticks) || phase.ticks < 0 ||
            !Number.isSafeInteger(phase.carriedTicks) || phase.carriedTicks < 0 || phase.carriedTicks > phase.ticks) throw new Error('Invalid garden snapshot');
      }
      safeGardens = new Map([...gardens].map(([id]) => [id, { ...gardenState(), ...safety[id] }]));
    },
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
