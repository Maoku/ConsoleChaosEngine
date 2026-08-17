import { describe, expect, it } from 'vitest';
import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  createRenderFrame,
} from '@console-chaos/engine';
import { TITLE_ASSET_SIZES, buildTitleRenderFrame } from '../src/app';
import { titleAnimationFrame } from '../src/animation';
import {
  TITLE_GENERATION_ASSETS,
  characterEyePatchKey,
  characterFrameKey,
  createTitleRenderManifest,
  eyePatchLayout,
} from '../src/render-manifest';

describe('title render frame', () => {
  it('contains one background, logo, and open-eye body for every generation', () => {
    const frame = createRenderFrame();
    buildTitleRenderFrame(frame, 0.25, true);

    expect(frame.backgrounds).toHaveLength(4);
    expect(frame.sprites).toHaveLength(9);
    for (const generation of GENERATION_IDS) {
      const backgrounds = frame.backgrounds.filter((command) => command.generations?.[0] === generation);
      const sprites = frame.sprites.filter((command) => command.generations?.[0] === generation);
      expect(backgrounds).toHaveLength(1);
      expect(sprites).toHaveLength(generation === 'PS2' ? 3 : 2);
      const logo = sprites.find((command) => command.id.startsWith('title-logo:'));
      const character = sprites.find((command) => command.id.startsWith('character:'));
      expect(logo).toMatchObject({
        screenSpace: true,
        texture: TITLE_GENERATION_ASSETS[generation].logo,
        generations: [generation],
      });
      expect(character).toMatchObject({
        screenSpace: true,
        texture: TITLE_GENERATION_ASSETS[generation].characterBodies.center,
        generations: [generation],
      });
      expect(character?.rotation).toBeUndefined();
      expect(character?.tweenTexture).toBeUndefined();
      if (generation === 'PS2') {
        expect(logo?.hardwareBlend).toBeUndefined();
        expect(character?.hardwareBlend).toBeUndefined();
        expect(logo?.alphaCutoff).toBe(0.5);
        expect(character?.alphaCutoff).toBe(0.5);
        expect(sprites.find((command) => command.id === 'character-eyes:PS2')).toMatchObject({
          texture: TITLE_GENERATION_ASSETS.PS2.characterFrames['character-center-open'],
          alphaCutoff: 0.5,
        });
      } else {
        expect(logo?.alphaCutoff).toBe(0.5);
        expect(character?.alphaCutoff).toBe(0.5);
      }
    }
  });

  it('uses texture Tween only for the PS1 body and keeps PS2 on discrete body and face patterns', () => {
    const timeSeconds = 0.1;
    const frame = createRenderFrame();
    buildTitleRenderFrame(frame, timeSeconds, false);
    for (const generation of GENERATION_IDS) {
      const character = frame.sprites.find((command) => command.id === `character:${generation}`)!;
      const animation = titleAnimationFrame(HARDWARE_GENERATION_PROFILES[generation], timeSeconds, false);
      expect(character.rotation).toBeUndefined();
      if (generation === 'PS2') {
        expect(character.texture).toBe(TITLE_GENERATION_ASSETS.PS2.characterBodies[animation.pose]);
        expect(character.tweenTexture).toBeUndefined();
        expect(character.textureMix).toBeUndefined();
        expect(character.hardwareBlend).toBeUndefined();
      } else {
        expect(character.texture).toBe(TITLE_GENERATION_ASSETS[generation].characterBodies[animation.tween.from]);
      }
      if (generation === 'FC' || generation === 'SFC' || generation === 'PS2') {
        expect(character.tweenTexture).toBeUndefined();
        expect(character.textureMix).toBeUndefined();
      } else {
        expect(character.tweenTexture).toBe(
          TITLE_GENERATION_ASSETS[generation].characterBodies[animation.tween.to],
        );
        expect(character.textureMix).toBe(animation.tween.progress);
        expect(character.textureMix).toBeGreaterThan(0);
        expect(character.textureMix).toBeLessThan(1);
      }
    }
  });

  it('uses exact key textures at Tween endpoints without rotation', () => {
    for (const timeSeconds of [0, 0.5, 1]) {
      const frame = createRenderFrame();
      buildTitleRenderFrame(frame, timeSeconds, false);
      for (const generation of ['PS1'] as const) {
        const character = frame.sprites.find((command) => command.id === `character:${generation}`)!;
        const animation = titleAnimationFrame(
          HARDWARE_GENERATION_PROFILES[generation],
          timeSeconds,
          false,
        );
        expect(character.texture).toBe(
          TITLE_GENERATION_ASSETS[generation].characterBodies[animation.tween.from],
        );
        expect(character.textureMix).toBe(0);
        expect(character.rotation).toBeUndefined();
      }
    }
  });

  it('adds only a small pose-matched eye patch while blinking', () => {
    const frame = createRenderFrame();
    buildTitleRenderFrame(frame, 2.9, false);
    expect(frame.sprites).toHaveLength(12);
    for (const generation of GENERATION_IDS) {
      const hardware = HARDWARE_GENERATION_PROFILES[generation];
      const animation = titleAnimationFrame(hardware, 2.9, false);
      expect(animation.eyes).toBe('closed');
      const body = frame.sprites.find((command) => command.id === `character:${generation}`)!;
      const eyes = frame.sprites.find((command) => command.id === `character-eyes:${generation}`);
      const layout = eyePatchLayout(TITLE_ASSET_SIZES[generation].character, generation);
      expect(body.texture).toBe(TITLE_GENERATION_ASSETS[generation].characterBodies[animation.tween.from]);
      expect(eyes).toMatchObject({
        texture: TITLE_GENERATION_ASSETS[generation].characterFrames[
          characterFrameKey(animation.tween.from, 'closed')
        ],
        size: layout.size,
      });
      expect(eyes?.rotation).toBeUndefined();
      expect(eyes!.size[0]).toBeLessThan(body.size[0] * 0.6);
      expect(eyes!.size[1]).toBeLessThan(body.size[1] / 3);
      if (generation === 'PS1') {
        expect(eyes?.tweenTexture).toBe(
          TITLE_GENERATION_ASSETS[generation].characterFrames[
            characterEyePatchKey(animation.tween.to, 'closed')
          ],
        );
        expect(eyes?.textureMix).toBe(animation.tween.progress);
        expect(eyes?.alphaCutoff).toBe(0.5);
      } else {
        expect(eyes?.tweenTexture).toBeUndefined();
        expect(eyes?.alphaCutoff).toBe(0.5);
        expect(eyes?.hardwareBlend).toBeUndefined();
      }
    }
  });

  it('renders every PS2 pose and eye combination as one body plus one non-tweened face pattern', () => {
    for (const pose of ['left', 'center', 'right'] as const) {
      for (const eyes of ['open', 'half', 'closed'] as const) {
        const frame = createRenderFrame();
        buildTitleRenderFrame(frame, 0, false, pose, eyes);
        const character = frame.sprites.find((command) => command.id === 'character:PS2')!;
        const face = frame.sprites.find((command) => command.id === 'character-eyes:PS2')!;
        expect(character).toMatchObject({
          texture: TITLE_GENERATION_ASSETS.PS2.characterBodies[pose],
          alphaCutoff: 0.5,
        });
        expect(face).toMatchObject({
          texture: TITLE_GENERATION_ASSETS.PS2.characterFrames[characterFrameKey(pose, eyes)],
          size: eyePatchLayout(TITLE_ASSET_SIZES.PS2.character, 'PS2').size,
          alphaCutoff: 0.5,
        });
        expect(character.tweenTexture).toBeUndefined();
        expect(character.textureMix).toBeUndefined();
        expect(character.hardwareBlend).toBeUndefined();
        expect(face.tweenTexture).toBeUndefined();
        expect(face.textureMix).toBeUndefined();
        expect(face.hardwareBlend).toBeUndefined();
      }
    }
  });

  it('keeps the zero-rotation composition inside each internal resolution without overlap', () => {
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

  it('registers the runtime bodies and face patterns without duplicate URLs', () => {
    const manifest = createTitleRenderManifest();
    const expected = [...new Set(Object.values(TITLE_GENERATION_ASSETS)
      .flatMap((variant) => [
        variant.logo,
        ...Object.values(variant.characterBodies),
        ...Object.values(variant.characterFrames),
      ]))];
    expect(manifest.textures.map((texture) => texture.url)).toEqual(expected);
    expect(new Set(expected).size).toBe(43);
    expect(manifest.models).toEqual([]);
    expect(manifest.atlases.map((atlas) => atlas.url)).toEqual(expected);
    expect(manifest.atlases.every((atlas) => atlas.columns === 1 && atlas.rows === 1)).toBe(true);
  });
});
