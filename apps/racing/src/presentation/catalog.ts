import {
  GENERATION_IDS,
  type GenerationId,
  type RenderAssetManifest,
} from '@console-chaos/engine';
import { GEN1_BACKGROUND, GEN1_CAR_ATLAS, GEN1_ROAD } from './gen1-raster';
import { GEN2_BACKGROUND, GEN2_CAR_ATLAS, GEN2_CIRCUIT } from './gen2-affine';

export const RACING_FALLBACK_TEXTURE = 'assets/common/fallback.png';

export function createRacingRenderManifest(): RenderAssetManifest {
  const fallbackTextures = {} as Record<GenerationId, string>;
  for (const generation of GENERATION_IDS) fallbackTextures[generation] = RACING_FALLBACK_TEXTURE;
  return {
    textures: [
      { url: RACING_FALLBACK_TEXTURE, flipY: true, wrap: 'repeat' },
      { url: GEN1_BACKGROUND, flipY: true, wrap: 'repeat' },
      { url: GEN1_ROAD, flipY: true, wrap: 'repeat' },
      { url: GEN2_BACKGROUND, flipY: true, wrap: 'repeat' },
      { url: GEN2_CIRCUIT, flipY: true, wrap: 'repeat' },
    ],
    models: [],
    atlases: [
      { url: GEN1_CAR_ATLAS, columns: 3, rows: 2 },
      { url: GEN2_CAR_ATLAS, columns: 3, rows: 2 },
    ],
    geometries: [{ kind: 'box' }],
    fallbackTextures,
  };
}
