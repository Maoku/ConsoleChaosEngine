import { describe, expect, it } from 'vitest';
import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  createRenderFrame,
} from '@console-chaos/engine';
import { TITLE_ASSET_SIZES, buildTitleRenderFrame } from '../src/app';
import { TITLE_GENERATION_ASSETS, createTitleRenderManifest } from '../src/render-manifest';

describe('title render frame', () => {
  it('contains one background, logo, and character for every generation', () => {
    const frame = createRenderFrame();
    buildTitleRenderFrame(frame, 0.25, true);

    expect(frame.backgrounds).toHaveLength(4);
    expect(frame.sprites).toHaveLength(8);
    for (const generation of GENERATION_IDS) {
      const backgrounds = frame.backgrounds.filter((command) => command.generations?.[0] === generation);
      const sprites = frame.sprites.filter((command) => command.generations?.[0] === generation);
      expect(backgrounds).toHaveLength(1);
      expect(sprites).toHaveLength(2);
      const logo = sprites.find((command) => command.id.startsWith('title-logo:'));
      const character = sprites.find((command) => command.id.startsWith('character:'));
      expect(logo).toMatchObject({
        screenSpace: true,
        texture: TITLE_GENERATION_ASSETS[generation].logo,
        generations: [generation],
      });
      expect(character).toMatchObject({
        screenSpace: true,
        texture: TITLE_GENERATION_ASSETS[generation].character,
        generations: [generation],
      });
      expect(logo?.atlas).toBeUndefined();
      expect(character?.atlas).toBeUndefined();
      if (generation === 'PS2') {
        expect(logo?.hardwareBlend).toEqual({ family: 'gen4-gs', preset: 'source-over' });
        expect(character?.hardwareBlend).toEqual({ family: 'gen4-gs', preset: 'source-over' });
      } else {
        expect(logo?.alphaCutoff).toBe(0.5);
        expect(character?.alphaCutoff).toBe(0.5);
      }
    }
  });

  it('keeps the zero-angle composition inside each internal resolution without overlap', () => {
    const frame = createRenderFrame();
    buildTitleRenderFrame(frame, 0.25, true);
    for (const generation of GENERATION_IDS) {
      const hardware = HARDWARE_GENERATION_PROFILES[generation];
      const sizes = TITLE_ASSET_SIZES[generation];
      const logo = frame.sprites.find((command) => command.id === `title-logo:${generation}`)!;
      const character = frame.sprites.find((command) => command.id === `character:${generation}`)!;
      const bounds = (position: readonly [number, number, number], size: readonly [number, number]) => ({
        left: position[0] - size[0] / 2,
        right: position[0] + size[0] / 2,
        top: position[1] - size[1] / 2,
        bottom: position[1] + size[1] / 2,
      });
      const logoBounds = bounds(logo.position, sizes.logo);
      const characterBounds = bounds(character.position, sizes.character);
      expect(logoBounds.left).toBeGreaterThanOrEqual(0);
      expect(logoBounds.right).toBeLessThanOrEqual(hardware.video.internalWidth);
      expect(logoBounds.top).toBeGreaterThanOrEqual(0);
      expect(characterBounds.left).toBeGreaterThanOrEqual(0);
      expect(characterBounds.right).toBeLessThanOrEqual(hardware.video.internalWidth);
      expect(characterBounds.bottom).toBeCloseTo(hardware.video.internalHeight, 12);
      expect(logoBounds.bottom).toBeLessThan(characterBounds.top);
    }
  });

  it('registers exactly the eight generated runtime textures', () => {
    const manifest = createTitleRenderManifest();
    const expected = Object.values(TITLE_GENERATION_ASSETS)
      .flatMap((variant) => [variant.logo, variant.character]);
    expect(manifest.textures.map((texture) => texture.url)).toEqual(expected);
    expect(new Set(expected).size).toBe(8);
    expect(manifest.models).toEqual([]);
    expect(manifest.atlases.map((atlas) => atlas.url)).toEqual(expected);
    expect(manifest.atlases.every((atlas) => atlas.columns === 1 && atlas.rows === 1)).toBe(true);
  });
});
