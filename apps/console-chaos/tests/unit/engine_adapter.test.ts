import { describe, expect, it } from 'vitest';
import {
  GENERATION_IDS,
  createWorld,
  validateSceneReferences,
} from '@console-chaos/engine';
import {
  CONSOLE_CHAOS_GENERATION_THEMES,
  composeLegacyGenerationProfile,
} from '@/config/generation';
import { adaptConsoleChaosLevel } from '@/content/level-adapter';
import { PROFILES } from '@/generation/profiles';
import { createConsoleChaosModule } from '@/app';
import { loadLevelFile } from './replay/harness';
import { createTestSession } from './session-testkit';

describe('Console Chaos engine adapter', () => {
  it('hardware profile + game theme reproduces every legacy field', () => {
    for (const generation of GENERATION_IDS) {
      expect(composeLegacyGenerationProfile(generation)).toEqual(PROFILES[generation]);
    }
  });

  it('defines every Console theme independently from hardware profiles', () => {
    expect(Object.keys(CONSOLE_CHAOS_GENERATION_THEMES).sort()).toEqual([...GENERATION_IDS].sort());
    for (const generation of GENERATION_IDS) {
      const theme = CONSOLE_CHAOS_GENERATION_THEMES[generation];
      expect(theme.display.channel).toMatch(/^CH [1-4]$/);
      expect(theme.availableActions).toContain('jump');
      expect(theme).not.toHaveProperty('video');
      expect(theme).not.toHaveProperty('audio');
      expect(theme).not.toHaveProperty('input.directional');
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
    const session = createTestSession({ level: loadLevelFile('mini'), world });
    expect(session.world).toBe(world);
    expect(world.entityCount).toBeGreaterThan(0);
  });
});
