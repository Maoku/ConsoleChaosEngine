import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { GENERATION_IDS, type GenerationId } from '@console-chaos/engine';
import { assertImage, cloneImage, type RgbaImage } from '../image/types';
import { decodePng, encodePng, readPng, rgbaEqual } from '../image/png';
import { analyzeImage } from '../validation/image';
import { validateGeneratedImage } from '../validation/outputs';
import { applyRecipeOverrides } from './overrides';
import {
  canonicalJson,
  createAssetManifest,
  createManifestOutput,
  formatAssetManifest,
  sha256,
  type AssetManifest,
} from './report';
import {
  isBuiltAsset,
  type AssetPipelineDefinition,
  type AssetSourceDefinition,
  type BuiltAsset,
  type JsonObject,
} from './define';

export type AssetPipelineCommand = 'build' | 'check';

export interface RunAssetPipelineOptions {
  readonly command: AssetPipelineCommand;
  readonly baseDir: string;
  readonly only?: string;
  readonly generations?: readonly GenerationId[];
  readonly overrides?: readonly string[];
  readonly allowAllOverrides?: boolean;
  readonly outDir?: string;
  readonly dryRun?: boolean;
}

export interface PlannedAssetOutput {
  readonly assetId: string;
  readonly generation: GenerationId;
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;
  readonly colorBudget: number | null;
  readonly paletteMode: string;
  readonly paletteBlockSize: number;
  readonly binaryAlpha: boolean;
  readonly textureFilter: string;
}

export interface RunAssetPipelineResult {
  readonly ok: boolean;
  readonly dryRun: boolean;
  readonly plan: readonly PlannedAssetOutput[];
  readonly manifest?: AssetManifest;
  readonly differences: readonly string[];
  readonly written: readonly string[];
  readonly appliedOverrides: readonly string[];
}

interface PreparedOutput {
  readonly asset: AssetSourceDefinition;
  readonly generation: GenerationId;
  readonly sourcePath: string;
  readonly sourceAbsolutePath: string;
  readonly sourceBytes: Buffer;
  readonly sourceImage: RgbaImage;
  readonly outputPath: string;
  readonly outputAbsolutePath: string;
  readonly plan: PlannedAssetOutput;
}

interface GeneratedOutput extends PreparedOutput {
  readonly image: RgbaImage;
  readonly paletteCount: number | null;
}

function assertRelativePath(path: unknown, label: string): string {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) {
    throw new Error(`${label} must be a non-empty relative path: ${String(path)}`);
  }
  const normalized = path.replaceAll('\\', '/');
  if (normalized.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`${label} must stay below the project directory: ${path}`);
  }
  return normalized;
}

function imageDiffers(path: string, image: RgbaImage): boolean {
  if (!existsSync(path)) return true;
  try {
    return !rgbaEqual(readPng(path), image);
  } catch {
    return true;
  }
}

function assertBelow(root: string, target: string, label: string): void {
  const path = relative(root, target);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error(`${label} escapes ${root}`);
}

function validateDefinition<Recipe extends JsonObject>(definition: AssetPipelineDefinition<Recipe>): void {
  if (definition.assets.length === 0) throw new Error('asset pipeline must define at least one asset');
  const ids = new Set<string>();
  const outputs = new Set<string>();
  for (const asset of definition.assets) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(asset.id)) throw new Error(`invalid asset id: ${asset.id}`);
    if (ids.has(asset.id)) throw new Error(`duplicate asset id: ${asset.id}`);
    ids.add(asset.id);
    assertRelativePath(asset.source, `${asset.id}.source`);
    const outputKeys = Object.keys(asset.outputs);
    for (const key of outputKeys) {
      if (!(GENERATION_IDS as readonly string[]).includes(key)) throw new Error(`${asset.id} has unknown generation: ${key}`);
    }
    for (const generation of GENERATION_IDS) {
      const output = asset.outputs[generation];
      assertRelativePath(output, `${asset.id}.outputs.${generation}`);
      if (outputs.has(output)) throw new Error(`duplicate output path: ${output}`);
      outputs.add(output);
    }
  }
  assertRelativePath(definition.manifestPath ?? 'asset-manifest.json', 'manifestPath');
}

function selectedGenerations(input: readonly GenerationId[] | undefined): readonly GenerationId[] {
  if (!input) return GENERATION_IDS;
  const seen = new Set<GenerationId>();
  for (const generation of input) {
    if (!(GENERATION_IDS as readonly string[]).includes(generation)) throw new Error(`unknown generation: ${generation}`);
    if (seen.has(generation)) throw new Error(`duplicate generation: ${generation}`);
    seen.add(generation);
  }
  return GENERATION_IDS.filter((generation) => seen.has(generation));
}

async function prepareOutputs<Recipe extends JsonObject>(
  definition: AssetPipelineDefinition<Recipe>,
  options: RunAssetPipelineOptions,
): Promise<PreparedOutput[]> {
  validateDefinition(definition);
  const baseDir = resolve(options.baseDir);
  const outputRoot = options.outDir ? resolve(options.outDir) : baseDir;
  const assets = options.only ? definition.assets.filter((asset) => asset.id === options.only) : definition.assets;
  if (options.only && assets.length === 0) throw new Error(`unknown asset id: ${options.only}`);
  const generations = selectedGenerations(options.generations);
  const sourceCache = new Map<string, { readonly bytes: Buffer; readonly image: RgbaImage }>();
  const prepared: PreparedOutput[] = [];
  for (const asset of assets) {
    const sourcePath = assertRelativePath(asset.source, `${asset.id}.source`);
    const sourceAbsolutePath = resolve(baseDir, sourcePath);
    assertBelow(baseDir, sourceAbsolutePath, `${asset.id}.source`);
    let source = sourceCache.get(sourceAbsolutePath);
    if (!source) {
      const bytes = await readFile(sourceAbsolutePath);
      const image = decodePng(bytes);
      source = { bytes, image };
      sourceCache.set(sourceAbsolutePath, source);
    }
    for (const generation of generations) {
      const outputPath = assertRelativePath(asset.outputs[generation], `${asset.id}.outputs.${generation}`);
      const outputAbsolutePath = resolve(outputRoot, outputPath);
      assertBelow(outputRoot, outputAbsolutePath, `${asset.id}.outputs.${generation}`);
      const spec = asset.assetClass.specFor(generation);
      prepared.push({
        asset,
        generation,
        sourcePath,
        sourceAbsolutePath,
        sourceBytes: source.bytes,
        sourceImage: source.image,
        outputPath,
        outputAbsolutePath,
        plan: {
          assetId: asset.id,
          generation,
          sourcePath,
          outputPath,
          width: spec.width,
          height: spec.height,
          colorBudget: spec.colorBudget,
          paletteMode: spec.paletteMode,
          paletteBlockSize: spec.paletteBlockSize,
          binaryAlpha: spec.binaryAlpha,
          textureFilter: spec.textureFilter,
        },
      });
    }
  }
  return prepared;
}

async function stageAtomicFiles(files: readonly { readonly target: string; readonly bytes: Uint8Array | string }[]): Promise<string[]> {
  const staged: Array<{ readonly target: string; readonly temporary: string }> = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (!file) continue;
      await mkdir(dirname(file.target), { recursive: true });
      const temporary = `${file.target}.asset-pipeline-${process.pid}-${index}.tmp`;
      await writeFile(temporary, file.bytes);
      staged.push({ target: file.target, temporary });
    }
    for (const file of staged) await rename(file.temporary, file.target);
    return staged.map((file) => file.target);
  } catch (error) {
    await Promise.all(staged.map((file) => rm(file.temporary, { force: true })));
    throw error;
  }
}

export async function runAssetPipeline<Recipe extends JsonObject>(
  definition: AssetPipelineDefinition<Recipe>,
  options: RunAssetPipelineOptions,
): Promise<RunAssetPipelineResult> {
  const assignments = options.overrides ?? [];
  if (assignments.length > 0 && !options.only && !options.allowAllOverrides) {
    throw new Error('--set without --only requires --allow-all-overrides');
  }
  const overridden = applyRecipeOverrides(definition.recipe, assignments);
  const prepared = await prepareOutputs(definition, options);
  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      plan: prepared.map((output) => output.plan),
      differences: [],
      written: [],
      appliedOverrides: overridden.applied.map((override) => override.assignment),
    };
  }

  const recipeSha256 = sha256(canonicalJson(overridden.recipe));
  const generated: GeneratedOutput[] = [];
  for (const output of prepared) {
    const spec = output.asset.assetClass.specFor(output.generation);
    const builtValue = await definition.build({
      asset: output.asset,
      generation: output.generation,
      spec,
      source: cloneImage(output.sourceImage),
      sourcePath: output.sourcePath,
      recipe: overridden.recipe,
    });
    const built: BuiltAsset = isBuiltAsset(builtValue) ? builtValue : { image: builtValue };
    assertImage(built.image);
    const errors = validateGeneratedImage(built.image, spec);
    if (errors.length > 0) throw new Error(`${output.asset.id}.${output.generation}: ${errors.join('; ')}`);
    const analysis = analyzeImage(built.image);
    const paletteCount = built.paletteCount ?? (spec.paletteMode === 'truecolor' ? null : analysis.visibleColorCount);
    if (paletteCount !== null && spec.colorBudget !== null && paletteCount > spec.colorBudget) {
      throw new Error(`${output.asset.id}.${output.generation}: palette count ${paletteCount} exceeds ${spec.colorBudget}`);
    }
    generated.push({ ...output, image: built.image, paletteCount });
  }

  const generatedManifest = createAssetManifest(
    generated.map((output) => {
      const spec = output.asset.assetClass.specFor(output.generation);
      return createManifestOutput({
        assetId: output.asset.id,
        sourcePath: output.sourcePath,
        sourceSha256: sha256(output.sourceBytes),
        recipeSha256,
        generation: output.generation,
        outputPath: output.outputPath,
        image: output.image,
        paletteMode: spec.paletteMode,
        paletteCount: output.paletteCount,
        paletteBlockSize: spec.paletteBlockSize,
      });
    }),
  );
  const outputRoot = options.outDir ? resolve(options.outDir) : resolve(options.baseDir);
  const manifestPath = assertRelativePath(definition.manifestPath ?? 'asset-manifest.json', 'manifestPath');
  const manifestAbsolutePath = resolve(outputRoot, manifestPath);
  assertBelow(outputRoot, manifestAbsolutePath, 'manifestPath');
  const fullSelection = generated.length === definition.assets.length * GENERATION_IDS.length;
  let manifest = generatedManifest;
  if (options.command === 'build' && !fullSelection && existsSync(manifestAbsolutePath)) {
    let current: AssetManifest;
    try {
      current = JSON.parse(await readFile(manifestAbsolutePath, 'utf8')) as AssetManifest;
      if (!Array.isArray(current.outputs)) throw new Error('outputs is not an array');
    } catch (error) {
      throw new Error(`cannot merge partial build into ${manifestPath}: ${(error as Error).message}`);
    }
    const replaced = new Set(generatedManifest.outputs.map((output) => `${output.assetId}.${output.generation}`));
    manifest = createAssetManifest([
      ...current.outputs.filter((output) => !replaced.has(`${output.assetId}.${output.generation}`)),
      ...generatedManifest.outputs,
    ]);
  }
  const manifestText = formatAssetManifest(manifest);

  if (options.command === 'check') {
    const differences: string[] = [];
    for (const output of generated) {
      if (!existsSync(output.outputAbsolutePath)) {
        differences.push(`${output.outputPath}: missing`);
        continue;
      }
      try {
        if (!rgbaEqual(readPng(output.outputAbsolutePath), output.image)) differences.push(`${output.outputPath}: RGBA differs`);
      } catch (error) {
        differences.push(`${output.outputPath}: ${(error as Error).message}`);
      }
    }
    if (!existsSync(manifestAbsolutePath)) differences.push(`${manifestPath}: missing`);
    else {
      try {
        const current = JSON.parse(await readFile(manifestAbsolutePath, 'utf8')) as AssetManifest;
        if (fullSelection) {
          if (canonicalJson(current) !== canonicalJson(generatedManifest)) differences.push(`${manifestPath}: manifest differs`);
        } else {
          const currentHeader = { ...current, outputs: [] };
          const expectedHeader = { ...generatedManifest, outputs: [] };
          if (canonicalJson(currentHeader) !== canonicalJson(expectedHeader)) differences.push(`${manifestPath}: manifest header differs`);
          const currentOutputs = new Map(current.outputs.map((output) => [`${output.assetId}.${output.generation}`, output]));
          for (const expected of generatedManifest.outputs) {
            const found = currentOutputs.get(`${expected.assetId}.${expected.generation}`);
            if (!found || canonicalJson(found) !== canonicalJson(expected)) {
              differences.push(`${manifestPath}: ${expected.assetId}.${expected.generation} differs`);
            }
          }
        }
      } catch (error) {
        differences.push(`${manifestPath}: ${(error as Error).message}`);
      }
    }
    return {
      ok: differences.length === 0,
      dryRun: false,
      plan: generated.map((output) => output.plan),
      manifest: generatedManifest,
      differences,
      written: [],
      appliedOverrides: overridden.applied.map((override) => override.assignment),
    };
  }

  const changes: Array<{ readonly target: string; readonly bytes: Uint8Array | string }> = [];
  for (const output of generated) {
    if (imageDiffers(output.outputAbsolutePath, output.image)) {
      changes.push({ target: output.outputAbsolutePath, bytes: encodePng(output.image) });
    }
  }
  if (!existsSync(manifestAbsolutePath) || (await readFile(manifestAbsolutePath, 'utf8')) !== manifestText) {
    changes.push({ target: manifestAbsolutePath, bytes: manifestText });
  }
  const writtenAbsolute = await stageAtomicFiles(changes);
  return {
    ok: true,
    dryRun: false,
    plan: generated.map((output) => output.plan),
    manifest,
    differences: [],
    written: writtenAbsolute.map((path) => relative(outputRoot, path).replaceAll('\\', '/')),
    appliedOverrides: overridden.applied.map((override) => override.assignment),
  };
}
