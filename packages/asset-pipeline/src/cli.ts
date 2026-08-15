#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCliArguments } from './cli/args';
import { runAssetPipeline } from './recipe/runner';
import { type AssetPipelineDefinition, type JsonObject } from './recipe/define';

const USAGE = `Usage:
  console-chaos-assets build --config <file> [--only <id>] [--generation <id>] [--set path=value]
                               [--allow-all-overrides] [--out-dir <dir>] [--dry-run]
  console-chaos-assets check --config <file> [--only <id>] [--generation <id>] [--out-dir <dir>]
`;

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const arguments_ = parseCliArguments(process.argv.slice(2));
  const configPath = resolve(process.cwd(), arguments_.config);
  const loaded = await import(pathToFileURL(configPath).href);
  const definition = (loaded.default ?? loaded.pipeline) as AssetPipelineDefinition<JsonObject> | undefined;
  if (!definition || typeof definition !== 'object' || typeof definition.build !== 'function') {
    throw new Error(`${arguments_.config} must default-export defineAssetPipeline(...)`);
  }
  const result = await runAssetPipeline(definition, {
    command: arguments_.command,
    baseDir: resolve(dirname(configPath), definition.rootDir ?? '.'),
    overrides: arguments_.overrides,
    dryRun: arguments_.dryRun,
    allowAllOverrides: arguments_.allowAllOverrides,
    ...(arguments_.only ? { only: arguments_.only } : {}),
    ...(arguments_.outDir ? { outDir: resolve(process.cwd(), arguments_.outDir) } : {}),
    ...(arguments_.generations ? { generations: arguments_.generations } : {}),
  });
  if (result.appliedOverrides.length > 0) console.log(`Overrides: ${result.appliedOverrides.join(' ')}`);
  if (result.dryRun) {
    for (const output of result.plan) {
      console.log(
        `${output.assetId}.${output.generation}: ${output.sourcePath} -> ${output.outputPath} ` +
          `${output.width}x${output.height} colors=${output.colorBudget ?? 'unlimited'} ` +
          `palette=${output.paletteMode} block=${output.paletteBlockSize} alpha=${output.binaryAlpha ? 'binary' : '8bit'} ` +
          `filter=${output.textureFilter}`,
      );
    }
    return;
  }
  if (arguments_.command === 'check') {
    if (result.ok) console.log(`Asset check passed (${result.plan.length} outputs)`);
    else {
      for (const difference of result.differences) console.error(difference);
      process.exitCode = 1;
    }
    return;
  }
  console.log(`Built ${result.plan.length} outputs; wrote ${result.written.length} files`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(USAGE);
  process.exitCode = 1;
});
