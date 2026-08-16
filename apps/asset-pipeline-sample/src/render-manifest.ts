import {
  defineGenerationVariant,
  type GenerationVariant,
  type RenderAssetManifest,
} from '@console-chaos/engine';

const assetUrl = (path: string): string => `${import.meta.env.BASE_URL}assets/generated/${path}`;

export interface TitleGenerationAssets {
  readonly logo: string;
  readonly character: string;
}

export const TITLE_GENERATION_ASSETS: GenerationVariant<TitleGenerationAssets> = defineGenerationVariant({
  FC: { logo: assetUrl('fc/title-logo.png'), character: assetUrl('fc/character.png') },
  SFC: { logo: assetUrl('sfc/title-logo.png'), character: assetUrl('sfc/character.png') },
  PS1: { logo: assetUrl('ps1/title-logo.png'), character: assetUrl('ps1/character.png') },
  PS2: { logo: assetUrl('ps2/title-logo.png'), character: assetUrl('ps2/character.png') },
});

export function createTitleRenderManifest(): RenderAssetManifest {
  const variants = Object.values(TITLE_GENERATION_ASSETS);
  return {
    textures: variants.flatMap((variant) => [
      { url: variant.logo },
      { url: variant.character },
    ]),
    models: [],
    atlases: [],
    geometries: [],
    fallbackTextures: {
      FC: TITLE_GENERATION_ASSETS.FC.logo,
      SFC: TITLE_GENERATION_ASSETS.SFC.logo,
      PS1: TITLE_GENERATION_ASSETS.PS1.logo,
      PS2: TITLE_GENERATION_ASSETS.PS2.logo,
    },
  };
}
