import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createGameHost,
  createNullAudioService,
  createRenderFrame,
  renderFrameSnapshot,
  type GenerationId,
} from '@console-chaos/engine';
import { createManualLoopHost, createRecordingRenderer } from '@console-chaos/engine-testkit';
import { createNeutralConsoleChaosActions } from '@/config/actions';
import { createSession, type Session } from '@/gameplay/session';
import { createConsoleChaosPresentation } from '@/presentation/frame';
import { loadLevelFile } from '../unit/replay/harness';

const level = loadLevelFile('area1');
const GOLDEN_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/render-command-golden.json',
);

function setup(generation: GenerationId, spawn: [number, number, number]) {
  const host = createGameHost({
    loopHost: createManualLoopHost(),
    renderer: createRecordingRenderer(),
    audio: createNullAudioService(),
    initialGeneration: generation,
  });
  const session = createSession({
    level,
    world: host.context.world,
    generation: host.context.generation,
    spawn,
  });
  const presentation = createConsoleChaosPresentation(level);
  return { host, session, presentation };
}

function tick(session: Session): void {
  session.tick(createNeutralConsoleChaosActions());
}

function signature(setupResult: ReturnType<typeof setup>) {
  const { host, session, presentation } = setupResult;
  const frame = createRenderFrame();
  presentation.fixedUpdate(session);
  presentation.build(frame, session, host.context);
  const normalized = JSON.stringify(renderFrameSnapshot(frame), (_key, value: unknown) => (
    typeof value === 'number' ? Number(value.toFixed(6)) : value
  ));
  const visible = <Command extends { visible?: boolean }>(commands: readonly Command[]): number => (
    commands.filter((command) => command.visible !== false).length
  );
  return {
    generation: host.context.generation.generation,
    renderGenerations: host.context.generation.renderGenerations(),
    transitionBlend: Number(host.context.generation.transition.blend.toFixed(6)),
    hash: createHash('sha256').update(normalized).digest('hex'),
    commands: {
      meshes: frame.meshes.length,
      visibleMeshes: visible(frame.meshes),
      skinnedMeshes: frame.skinnedMeshes.length,
      visibleSkinnedMeshes: visible(frame.skinnedMeshes),
      sprites: frame.sprites.length,
      visibleSprites: visible(frame.sprites),
      lights: frame.lights.length,
      backgrounds: frame.backgrounds.length,
      materials: frame.materials.length,
      overlays: frame.overlays.length,
    },
  };
}

function centerOf(entityIds: readonly string[]): [number, number, number] {
  const positions = entityIds.map((id) => level.entities.find((entity) => entity.id === id)?.transform.position)
    .filter((position): position is [number, number, number] => position !== undefined);
  return positions.reduce<[number, number, number]>((center, position) => [
    center[0] + position[0] / positions.length,
    center[1] + position[1] / positions.length,
    center[2] + position[2] / positions.length,
  ], [0, 0, 0]);
}

function captureAll() {
  const captures: Record<string, ReturnType<typeof signature>> = {};
  for (const generation of ['FC', 'SFC', 'PS1', 'PS2'] as const) {
    const current = setup(generation, [...level.spawn.position]);
    tick(current.session);
    captures[`generation:${generation}`] = signature(current);
    current.host.dispose();
  }
  for (const puzzle of level.puzzles) {
    const generation = puzzle.requiredGenerations[0] ?? 'PS1';
    const current = setup(generation, centerOf(puzzle.entities));
    tick(current.session);
    captures[`puzzle:${puzzle.puzzleId}`] = signature(current);
    current.host.dispose();
  }
  const transition = setup('PS1', [...level.spawn.position]);
  tick(transition.session);
  transition.host.context.generation.request('PS2');
  transition.host.context.generation.advance(175);
  tick(transition.session);
  captures['transition:PS1-PS2@50%'] = signature(transition);
  transition.host.dispose();
  return captures;
}

describe('Console render capture golden', () => {
  it('keeps 4 generations, transition midpoint, and all 6 puzzle views exact', () => {
    const expected = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as unknown;
    expect(captureAll()).toEqual(expected);
  });
});
