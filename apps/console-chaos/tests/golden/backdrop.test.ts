import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GENERATION_IDS, HARDWARE_GENERATION_PROFILES, nearestMasterIndex } from '@console-chaos/engine';
import { CONSOLE_CHAOS_GENERATION_THEMES } from '@/config/generation';
import { FC_PALETTE, KEY_COLORS } from '@/render/key_palette';

const TEXTURE_DIR = 'public/assets/textures';

describe('generation backdrop theme', () => {
  it('keeps hardware and artwork as two complete generation records', () => {
    expect(Object.keys(HARDWARE_GENERATION_PROFILES).sort()).toEqual([...GENERATION_IDS].sort());
    expect(Object.keys(CONSOLE_CHAOS_GENERATION_THEMES).sort()).toEqual([...GENERATION_IDS].sort());
  });

  it('references an existing generation-specific texture set and every backdrop layer', () => {
    const sets = new Set<string>();
    for (const id of GENERATION_IDS) {
      const { textureSet, backdrop } = CONSOLE_CHAOS_GENERATION_THEMES[id].art;
      sets.add(textureSet);
      expect(existsSync(join(TEXTURE_DIR, textureSet)), `${textureSet} is missing`).toBe(true);
      for (const layer of [backdrop.far, backdrop.near]) {
        if (layer) expect(existsSync(join(TEXTURE_DIR, textureSet, layer.texture))).toBe(true);
      }
    }
    expect(sets.size).toBe(GENERATION_IDS.length);
  });

  it('uses the measured daylight colors only for the unconstrained fourth generation', () => {
    expect(CONSOLE_CHAOS_GENERATION_THEMES.PS2.art.backdrop.sky).toEqual([
      KEY_COLORS.skyDay,
      KEY_COLORS.skyHorizon,
    ]);
    for (const id of ['FC', 'SFC', 'PS1'] as const) {
      expect(CONSOLE_CHAOS_GENERATION_THEMES[id].art.backdrop.sky[0]).not.toEqual(KEY_COLORS.skyDay);
    }
  });

  it('keeps every FC backdrop color inside the declared fixed palette', () => {
    const allowed = new Set(FC_PALETTE.map((entry) => entry.index));
    for (const color of CONSOLE_CHAOS_GENERATION_THEMES.FC.art.backdrop.sky) {
      expect(allowed.has(nearestMasterIndex(...color))).toBe(true);
    }
  });

  it('enables dynamic light only on the generation that can render the torch', () => {
    expect(GENERATION_IDS.filter((id) => HARDWARE_GENERATION_PROFILES[id].video.dynamicLight)).toEqual(['PS2']);
  });
});
