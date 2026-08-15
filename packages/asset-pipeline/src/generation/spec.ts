import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  MASTER_PALETTE_RGB,
  type GenerationId,
  type GenerationVariant,
  type PaletteMode,
} from '@console-chaos/engine';
import { type Rgb, type Size } from '../image/types';

export interface GenerationAssetSpec {
  readonly generation: GenerationId;
  readonly internalWidth: number;
  readonly internalHeight: number;
  readonly paletteMode: PaletteMode;
  readonly paletteBlockSize: number;
  readonly tileSnap: number;
  readonly binaryAlpha: boolean;
  readonly rgb555: boolean;
  readonly textureFilter: 'nearest' | 'linear';
  readonly masterPalette: readonly Rgb[] | null;
}

export function deriveGenerationAssetSpec(generation: GenerationId): GenerationAssetSpec {
  const profile = HARDWARE_GENERATION_PROFILES[generation];
  const { video } = profile;
  return {
    generation,
    internalWidth: video.internalWidth,
    internalHeight: video.internalHeight,
    paletteMode: video.paletteMode,
    paletteBlockSize: video.paletteBlockSize,
    tileSnap: video.tileSnap,
    binaryAlpha: video.translucency.kind !== 'gs-alpha',
    rgb555: video.paletteMode === 'rgb555',
    textureFilter: video.textureFilter,
    masterPalette: video.paletteMode === 'fixed54' ? MASTER_PALETTE_RGB : null,
  };
}

export interface AssetClassDefinition {
  readonly id: string;
  /** Per-asset budget. null means truecolor/unlimited. */
  readonly colorBudget: GenerationVariant<number | null>;
  readonly targetSize: (generation: GenerationId, spec: GenerationAssetSpec) => Size | number;
}

export interface AssetClassGenerationSpec extends GenerationAssetSpec, Size {
  readonly colorBudget: number | null;
}

export interface DefinedAssetClass {
  readonly id: string;
  readonly generations: Readonly<Record<GenerationId, AssetClassGenerationSpec>>;
  readonly specFor: (generation: GenerationId) => AssetClassGenerationSpec;
}

export function defineAssetClass(definition: AssetClassDefinition): DefinedAssetClass {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(definition.id)) throw new Error(`invalid asset class id: ${definition.id}`);
  const generations = Object.fromEntries(
    GENERATION_IDS.map((generation) => {
      const hardware = deriveGenerationAssetSpec(generation);
      const requested = definition.targetSize(generation, hardware);
      const size = typeof requested === 'number' ? { width: requested, height: requested } : requested;
      if (!Number.isInteger(size.width) || size.width <= 0 || !Number.isInteger(size.height) || size.height <= 0) {
        throw new Error(`${definition.id}.${generation} has invalid target size ${size.width}x${size.height}`);
      }
      const colorBudget = definition.colorBudget[generation];
      if (colorBudget !== null && (!Number.isInteger(colorBudget) || colorBudget <= 0)) {
        throw new Error(`${definition.id}.${generation} has invalid color budget ${colorBudget}`);
      }
      return [generation, { ...hardware, ...size, colorBudget }];
    }),
  ) as unknown as Readonly<Record<GenerationId, AssetClassGenerationSpec>>;
  return {
    id: definition.id,
    generations,
    specFor(generation: GenerationId): AssetClassGenerationSpec {
      return generations[generation];
    },
  };
}
