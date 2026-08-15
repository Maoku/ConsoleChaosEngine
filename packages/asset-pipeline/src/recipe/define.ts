import { type GenerationId, type GenerationVariant } from '@console-chaos/engine';
import { type AssetClassGenerationSpec, type DefinedAssetClass } from '../generation/spec';
import { type RgbaImage } from '../image/types';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface AssetSourceDefinition {
  readonly id: string;
  readonly source: string;
  readonly outputs: GenerationVariant<string>;
  readonly assetClass: DefinedAssetClass;
}

export interface AssetBuildContext<Recipe extends JsonObject> {
  readonly asset: AssetSourceDefinition;
  readonly generation: GenerationId;
  readonly spec: AssetClassGenerationSpec;
  readonly source: RgbaImage;
  readonly sourcePath: string;
  readonly recipe: Recipe;
}

export interface BuiltAsset {
  readonly image: RgbaImage;
  readonly paletteCount?: number | null;
}

export interface AssetPipelineDefinition<Recipe extends JsonObject = JsonObject> {
  /** Project root relative to the config file. Defaults to the config directory. */
  readonly rootDir?: string;
  readonly recipe: Recipe;
  readonly assets: readonly AssetSourceDefinition[];
  readonly manifestPath?: string;
  readonly build: (context: AssetBuildContext<Recipe>) => RgbaImage | BuiltAsset | Promise<RgbaImage | BuiltAsset>;
}

export function defineAssetPipeline<Recipe extends JsonObject>(
  definition: AssetPipelineDefinition<Recipe>,
): AssetPipelineDefinition<Recipe> {
  return definition;
}

export function isBuiltAsset(value: RgbaImage | BuiltAsset): value is BuiltAsset {
  return 'image' in value;
}
