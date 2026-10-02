import { describe, expect, it } from 'vitest';
import { createGenerationController, createWorld, GENERATION_IDS } from '@console-chaos/engine';
import { parseStage, stageLevel } from '@/content/stage-schema';
import { createStageSession } from '@/gameplay/stage-session';
import { createNeutralConsoleChaosActions } from '@/config/actions';
import { createStageProgress } from '@/gameplay/stage-progress';
import { flickerPath } from '@/gameplay/puzzles/flicker-path';
import { stageEntity, stageFixture } from './stage-testkit';

describe('v2 stage contracts and runtime', () => {
  it('rejects invalid references, duplicate instances, dishonest channel declarations and unknown fields', () => {
    const stage = stageFixture();
    for (const mutate of [
      (data: typeof stage) => { data.instances[0]!.bindings.terminal = 'missing'; },
      (data: typeof stage) => { data.instances[1]!.id = 'a'; },
      (data: typeof stage) => { data.instances[1]!.bindings.wall = data.instances[0]!.bindings.wall!; },
      (data: typeof stage) => { data.exit.requires.push('missing'); },
      (data: typeof stage) => { data.instances[0]!.completionGenerations = ['FC']; },
      (data: typeof stage) => { Object.assign(data.instances[0]!.settings, { unknown: 1 }); },
    ]) {
      const copy = structuredClone(stage);
      mutate(copy);
      expect(() => parseStage(copy)).toThrow();
    }
    expect(stageLevel(stage).puzzles.map((p) => p.puzzleId)).toEqual(['a', 'b']);
  });

  it.each(GENERATION_IDS)('cannot clear by contacting the unpowered goal in %s', (generation) => {
    const session = createStageSession(stageFixture(), { generation: createGenerationController(generation) });
    session.player.position = [12, 1, 0];
    session.tick(createNeutralConsoleChaosActions());
    expect(session.cleared).toBe(false);
    expect(session.bodies().get('gate')!.solid).toBe(true);
    session.dispose();
  });

  it('isolates identical puzzle families and requires every achievement plus exit contact', () => {
    const session = createStageSession(stageFixture(), { generation: createGenerationController('PS1') });
    session.player.position = [4, 1, 2];
    session.tick(createNeutralConsoleChaosActions());
    expect([...session.solved]).toEqual(['a']);
    expect([...session.runtime!.progress.completed]).toEqual(['a-connected']);
    session.player.position = [12, 1, 0];
    session.tick(createNeutralConsoleChaosActions());
    expect(session.cleared).toBe(false);
    session.player.position = [8, 1, 2];
    session.tick(createNeutralConsoleChaosActions());
    expect([...session.solved]).toEqual(['a', 'b']);
    session.player.position = [12, 1, 0];
    session.tick(createNeutralConsoleChaosActions());
    expect(session.cleared).toBe(true);
    expect(session.bodies().get('gate')!.solid).toBe(false);
  });

  it('preserves achievements through falling and destroys only owned entities, idempotently', () => {
    const world = createWorld();
    const sentinel = world.create();
    const generation = createGenerationController('PS1');
    const session = createStageSession(stageFixture(), { world, generation });
    session.player.position = [4, 1, 2];
    session.tick(createNeutralConsoleChaosActions());
    session.retryCheckpoint();
    for (let tick = 0; tick < 24; tick++) session.tick(createNeutralConsoleChaosActions());
    expect(session.solved.has('a')).toBe(true);
    expect(session.player.position[0]).toBe(0);
    session.dispose();
    session.dispose();
    expect(world.entityCount).toBe(1);
    expect(world.alive(sentinel)).toBe(true);
    const position = [...session.player.position];
    generation.request('FC');
    expect(session.player.position).toEqual(position);
    expect(() => session.tick(createNeutralConsoleChaosActions())).toThrow('Disposed');
    const next = createStageSession(stageFixture(), { world, generation });
    next.dispose();
    expect(world.entityCount).toBe(1);
  });

  it('keeps the learned F-2 route, restores broken stones and accepts a different crossing channel', () => {
    const stage = stageFixture();
    const tiles = Array.from({ length: 6 }, (_, index) => 'tile-' + index);
    const lamps = Array.from({ length: 3 }, (_, index) => 'lamp-' + index);
    const swarm = Array.from({ length: 12 }, (_, index) => 'swarm-' + index);
    stage.instances = [{
      ...stage.instances[0]!, id: 'path', kind: 'F-2', bindings: { tiles, lamps, swarm, terminal: 'a-terminal' },
      achievement: 'path-connected', settings: { safeCount: 3 }, hintGenerations: ['FC'], completionGenerations: [...GENERATION_IDS],
    }];
    stage.exit.requires = ['path-connected'];
    stage.scene.entities.push(
      ...tiles.map((id, index) => stageEntity(id, [index + 2, 1, 0], [0.5, 0.25, 0.5], true)),
      ...lamps.map((id) => stageEntity(id, [0, 3, 0])),
      ...swarm.map((id) => stageEntity(id, [5, 3, 0])),
    );
    const session = createStageSession(parseStage(stage), { generation: createGenerationController('SFC'), seed: 7 });
    session.tick(createNeutralConsoleChaosActions());
    const seed = session.runtime!.seed('path');
    const route = flickerPath(6, 3, seed);
    const fakeIndex = tiles.findIndex((_, index) => !route.includes(index + 1));
    session.player.position = [fakeIndex + 2, 2.05, 0];
    session.tick(createNeutralConsoleChaosActions());
    expect(session.bodies().get(tiles[fakeIndex]!)!.solid).toBe(false);
    session.retryCheckpoint();
    for (let tick = 0; tick < 24; tick++) session.tick(createNeutralConsoleChaosActions());
    expect(session.runtime!.seed('path')).toBe(seed);
    expect(session.bodies().get(tiles[fakeIndex]!)!.solid).toBe(true);
    session.player.position = [4, 1, 2];
    session.tick(createNeutralConsoleChaosActions());
    expect(session.solved.has('path')).toBe(true);
  });

  it('grants each achievement once and rejects invalid restored progress', () => {
    const progress = createStageProgress(['a']);
    expect(progress.grant('a')).toBe(true);
    expect(progress.grant('a')).toBe(false);
    expect(() => progress.restore(['unknown'])).toThrow();
    expect([...progress.completed]).toEqual(['a']);
  });
});
