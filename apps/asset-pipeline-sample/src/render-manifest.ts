import {
  defineGenerationVariant,
  type GenerationId,
  type GenerationVariant,
  type RenderAssetManifest,
} from '@console-chaos/engine';
import {
  CHARACTER_POSES,
  EYE_FRAMES,
  type CharacterPose,
  type EyeFrame,
} from './animation';

const assetUrl = (path: string): string => `${import.meta.env.BASE_URL}assets/generated/${path}`;

export const EYE_PATCH_FRAMES = ['half', 'closed'] as const satisfies readonly EyeFrame[];
export const EYE_PATCH_REGION = { left: 0.29, top: 0.19, right: 0.71, bottom: 0.39 } as const;

export type EyePatchFrame = (typeof EYE_PATCH_FRAMES)[number];
export type CharacterFrameKey = `character-${CharacterPose}-${EyeFrame}`;
export type CharacterBodyKey = Extract<CharacterFrameKey, `character-${CharacterPose}-open`>;
export type CharacterEyePatchKey = Extract<CharacterFrameKey, `character-${CharacterPose}-${EyePatchFrame}`>;

export interface EyePatchLayout {
  readonly offset: readonly [number, number];
  readonly size: readonly [number, number];
}

export interface TitleGenerationAssets {
  readonly logo: string;
  readonly characterFrames: Readonly<Record<CharacterFrameKey, string>>;
}

export function characterFrameKey(pose: CharacterPose, eyes: EyeFrame): CharacterFrameKey {
  return `character-${pose}-${eyes}`;
}

export function characterBodyKey(pose: CharacterPose): CharacterBodyKey {
  return `character-${pose}-open`;
}

export function characterEyePatchKey(
  pose: CharacterPose,
  eyes: EyePatchFrame,
): CharacterEyePatchKey {
  return `character-${pose}-${eyes}`;
}

/** Matches tools/art.config.mjs; offset is relative to the full-body sprite centre. */
export function eyePatchLayout(characterSize: readonly [number, number]): EyePatchLayout {
  const [width, height] = characterSize;
  const x0 = Math.floor(width * EYE_PATCH_REGION.left);
  const y0 = Math.floor(height * EYE_PATCH_REGION.top);
  const x1 = Math.ceil(width * EYE_PATCH_REGION.right);
  const y1 = Math.ceil(height * EYE_PATCH_REGION.bottom);
  const patchWidth = x1 - x0;
  const patchHeight = y1 - y0;
  return {
    offset: [x0 + patchWidth / 2 - width / 2, y0 + patchHeight / 2 - height / 2],
    size: [patchWidth, patchHeight],
  };
}

function generationAssets(generation: GenerationId): TitleGenerationAssets {
  const directory = generation.toLowerCase();
  const characterFrames = Object.fromEntries(
    CHARACTER_POSES.flatMap((pose) =>
      EYE_FRAMES.map((eyes) => {
        const key = characterFrameKey(pose, eyes);
        return [key, assetUrl(`${directory}/${key}.png`)] as const;
      }),
    ),
  ) as Record<CharacterFrameKey, string>;
  return {
    logo: assetUrl(`${directory}/title-logo.png`),
    characterFrames,
  };
}

export const TITLE_GENERATION_ASSETS: GenerationVariant<TitleGenerationAssets> = defineGenerationVariant({
  FC: generationAssets('FC'),
  SFC: generationAssets('SFC'),
  PS1: generationAssets('PS1'),
  PS2: generationAssets('PS2'),
});

export function createTitleRenderManifest(): RenderAssetManifest {
  const variants = Object.values(TITLE_GENERATION_ASSETS);
  const generatedUrls = variants.flatMap((variant) => [
    variant.logo,
    ...Object.values(variant.characterFrames),
  ]);
  return {
    textures: generatedUrls.map((url) => ({ url })),
    models: [],
    // SpriteCommand uses the Engine's atlas draw path. A 1x1 sheet preserves
    // the generated bitmap unchanged while keeping the explicit texture URL.
    atlases: generatedUrls.map((url) => ({ url, columns: 1, rows: 1 })),
    geometries: [],
    fallbackTextures: {
      FC: TITLE_GENERATION_ASSETS.FC.logo,
      SFC: TITLE_GENERATION_ASSETS.SFC.logo,
      PS1: TITLE_GENERATION_ASSETS.PS1.logo,
      PS2: TITLE_GENERATION_ASSETS.PS2.logo,
    },
  };
}
