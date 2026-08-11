import {
  GENERATION_IDS,
  type GenerationId,
  type RenderAssetManifest,
} from '@console-chaos/engine';

export const RACING_FALLBACK_TEXTURE = 'assets/common/fallback.png';

export function createRacingRenderManifest(): RenderAssetManifest {
  const fallbackTextures = {} as Record<GenerationId, string>;
  for (const generation of GENERATION_IDS) fallbackTextures[generation] = RACING_FALLBACK_TEXTURE;
  return {
    textures: [{ url: RACING_FALLBACK_TEXTURE, flipY: true, wrap: 'repeat' }],
    models: [],
    atlases: [],
    geometries: [{ kind: 'box' }],
    fallbackTextures,
  };
}
