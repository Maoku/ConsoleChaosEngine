import { describe, expect, it } from 'vitest';
import {
  GENERATION_IDS,
  createWorld,
  validateSceneReferences,
} from '@console-chaos/engine';
import { composeLegacyGenerationProfile } from '@/config/generation';
import { adaptConsoleChaosLevel } from '@/content/level-adapter';
import { PROFILES } from '@/generation/profiles';
import { createConsoleChaosModule } from '@/app';
import { createSession } from '@/gameplay/session';
import { loadLevelFile } from './replay/harness';

describe('Console Chaos engine adapter', () => {
  it('hardware profile + game theme reproduces every legacy field', () => {
    for (const generation of GENERATION_IDS) {
      expect(composeLegacyGenerationProfile(generation)).toEqual(PROFILES[generation]);
    }
  });

  it('exposes the deterministic game as a GameModule', () => {
    const module = createConsoleChaosModule(loadLevelFile('mini'));
    expect(module.id).toBe('console-chaos');
  });

  it('adapts legacy levels without moving app-only metadata into engine scene data', () => {
    const level = loadLevelFile('mini');
    const scene = adaptConsoleChaosLevel(level);
    expect(validateSceneReferences(scene)).toEqual([]);
    expect(scene.entities).toHaveLength(level.entities.length);
    expect(scene.sectors).toHaveLength(level.sectors.length);
    expect(scene).not.toHaveProperty('puzzles');
    expect(scene).not.toHaveProperty('checkpoints');
    expect(scene).not.toHaveProperty('spawn');
  });

  it('can run a session on the GameHost-owned World', () => {
    const world = createWorld();
    const session = createSession({ level: loadLevelFile('mini'), world });
    expect(session.world).toBe(world);
    expect(world.entityCount).toBeGreaterThan(0);
  });
});
