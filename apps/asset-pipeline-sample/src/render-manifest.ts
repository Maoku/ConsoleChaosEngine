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

export type CharacterFrameKey = `character-${CharacterPose}-${EyeFrame}`;

export interface TitleGenerationAssets {
  readonly logo: string;
  readonly characters: Readonly<Record<CharacterFrameKey, string>>;
}

export function characterFrameKey(pose: CharacterPose, eyes: EyeFrame): CharacterFrameKey {
  return `character-${pose}-${eyes}`;
}

function generationAssets(generation: GenerationId): TitleGenerationAssets {
  const directory = generation.toLowerCase();
  const characters = Object.fromEntries(
    CHARACTER_POSES.flatMap((pose) =>
      EYE_FRAMES.map((eyes) => {
        const key = characterFrameKey(pose, eyes);
        return [key, assetUrl(`${directory}/${key}.png`)] as const;
      }),
    ),
  ) as Record<CharacterFrameKey, string>;
  return {
    logo: assetUrl(`${directory}/title-logo.png`),
    characters,
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
    ...Object.values(variant.characters),
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
