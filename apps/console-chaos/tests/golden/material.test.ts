import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nearestMasterIndex } from '@console-chaos/engine';
import { decodePng } from '@console-chaos/asset-pipeline';
import { CONSOLE_CHAOS_GENERATION_THEMES } from '@/config/generation';
import { parseLevel } from '@/level/loader';
import { MATERIALS, materialFor, requiredModels, requiredTextures } from '@/render/material';

const TEXTURE_DIR = 'public/assets/textures';
const area1 = parseLevel(JSON.parse(readFileSync('public/assets/levels/area1.json', 'utf8')), 'area1.json');

function vineOf(set: string, entity: string) {
  return decodePng(readFileSync(join(TEXTURE_DIR, set, materialFor('vine', entity).texture)));
}

describe('material content contract', () => {
  it('assigns an explicit material and all five roles to the level vocabulary', () => {
    const types = new Set(area1.entities.map((entity) => entity.type));
    for (const type of types) expect(MATERIALS[type], `${type} has no material`).toBeDefined();
    expect(new Set([...types].map((type) => MATERIALS[type]!.role))).toEqual(
      new Set(['background', 'platform', 'gimmick', 'enemy', 'goal']),
    );
  });

  it('ships every required texture in all four theme-owned sets', () => {
    for (const theme of Object.values(CONSOLE_CHAOS_GENERATION_THEMES)) {
      for (const file of requiredTextures()) {
        expect(existsSync(join(TEXTURE_DIR, theme.art.textureSet, file)), `${theme.art.textureSet}/${file}`).toBe(true);
      }
    }
  });

  it('ships every required model', () => {
    for (const model of requiredModels()) {
      expect(existsSync(join('public/assets/models', `${model}.gltf`)), model).toBe(true);
    }
  });

  it('keeps top textures, interior darkness, and shadow casting in app-owned material data', () => {
    expect(MATERIALS.platform?.topTexture).toBe('grass_top.png');
    expect(MATERIALS.causeway?.interior).toBe(true);
    expect(MATERIALS.causeway?.topTexture).toBeNull();
    expect(Object.values(MATERIALS).some((material) => material.castShadow)).toBe(true);
  });

  it('keeps F-1 vines identical in FC and distinguishable in SFC', () => {
    const fc = CONSOLE_CHAOS_GENERATION_THEMES.FC.art.textureSet;
    const sfc = CONSOLE_CHAOS_GENERATION_THEMES.SFC.art.textureSet;
    const fcA = vineOf(fc, 'f1_vine_a');
    const fcB = vineOf(fc, 'f1_vine_b');
    const sfcA = vineOf(sfc, 'f1_vine_a');
    const sfcB = vineOf(sfc, 'f1_vine_b');
    let sfcDifference = false;
    for (let index = 0; index < fcA.data.length; index += 4) {
      if (fcA.data[index + 3] === 0) continue;
      expect(nearestMasterIndex(fcA.data[index]!, fcA.data[index + 1]!, fcA.data[index + 2]!)).toBe(
        nearestMasterIndex(fcB.data[index]!, fcB.data[index + 1]!, fcB.data[index + 2]!),
      );
      const a = [sfcA.data[index]! & 0xf8, sfcA.data[index + 1]! & 0xf8, sfcA.data[index + 2]! & 0xf8];
      const b = [sfcB.data[index]! & 0xf8, sfcB.data[index + 1]! & 0xf8, sfcB.data[index + 2]! & 0xf8];
      if (a.some((value, channel) => value !== b[channel])) sfcDifference = true;
    }
    expect(sfcDifference).toBe(true);
  });
});
