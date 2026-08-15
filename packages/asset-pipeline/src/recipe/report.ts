import { createHash } from 'node:crypto';
import {
  ENGINE_VERSION,
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  type GenerationId,
  type PaletteMode,
} from '@console-chaos/engine';
import { ASSET_PIPELINE_VERSION } from '../version';
import { analyzeImage, type AlphaMode } from '../validation/image';
import { type RgbaImage } from '../image/types';
import { type JsonValue } from './define';

export function canonicalJson(value: JsonValue | object): string {
  const visit = (item: unknown): string => {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('canonical JSON cannot encode a non-finite number');
      return JSON.stringify(item);
    }
    if (Array.isArray(item)) return `[${item.map(visit).join(',')}]`;
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${visit(record[key])}`)
        .join(',')}}`;
    }
    throw new Error(`canonical JSON cannot encode ${typeof item}`);
  };
  return visit(value);
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export const GENERATION_PROFILE_SHA256 = sha256(
  canonicalJson(GENERATION_IDS.map((generation) => HARDWARE_GENERATION_PROFILES[generation])),
);

export interface AssetManifestOutput {
  readonly assetId: string;
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly recipeSha256: string;
  readonly generation: GenerationId;
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;
  readonly visibleColorCount: number;
  readonly alphaMode: AlphaMode;
  readonly paletteMode: PaletteMode;
  readonly paletteCount: number | null;
  readonly paletteBlockSize: number;
  readonly rgbaSha256: string;
}

export interface AssetManifest {
  readonly schemaVersion: 1;
  readonly pipelineVersion: string;
  readonly engineVersion: string;
  readonly generationProfileSha256: string;
  readonly outputs: readonly AssetManifestOutput[];
}

export interface ManifestOutputInput {
  readonly assetId: string;
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly recipeSha256: string;
  readonly generation: GenerationId;
  readonly outputPath: string;
  readonly image: RgbaImage;
  readonly paletteMode: PaletteMode;
  readonly paletteCount: number | null;
  readonly paletteBlockSize: number;
}

export function createManifestOutput(input: ManifestOutputInput): AssetManifestOutput {
  const analysis = analyzeImage(input.image);
  return {
    assetId: input.assetId,
    sourcePath: input.sourcePath,
    sourceSha256: input.sourceSha256,
    recipeSha256: input.recipeSha256,
    generation: input.generation,
    outputPath: input.outputPath,
    width: input.image.width,
    height: input.image.height,
    visibleColorCount: analysis.visibleColorCount,
    alphaMode: analysis.alphaMode,
    paletteMode: input.paletteMode,
    paletteCount: input.paletteCount,
    paletteBlockSize: input.paletteBlockSize,
    rgbaSha256: sha256(input.image.data),
  };
}

export function createAssetManifest(outputs: readonly AssetManifestOutput[]): AssetManifest {
  return {
    schemaVersion: 1,
    pipelineVersion: ASSET_PIPELINE_VERSION,
    engineVersion: ENGINE_VERSION,
    generationProfileSha256: GENERATION_PROFILE_SHA256,
    outputs: [...outputs].sort((left, right) =>
      left.assetId.localeCompare(right.assetId) ||
      GENERATION_IDS.indexOf(left.generation) - GENERATION_IDS.indexOf(right.generation) ||
      left.outputPath.localeCompare(right.outputPath),
    ),
  };
}

export function formatAssetManifest(manifest: AssetManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
