import { GENERATION_IDS, type GenerationId } from '@console-chaos/engine';
import { type AssetPipelineCommand } from '../recipe/runner';

export interface AssetPipelineCliArguments {
  readonly command: AssetPipelineCommand;
  readonly config: string;
  readonly only?: string;
  readonly generations?: readonly GenerationId[];
  readonly overrides: readonly string[];
  readonly outDir?: string;
  readonly dryRun: boolean;
  readonly allowAllOverrides: boolean;
}

function valueAfter(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseCliArguments(argv: readonly string[]): AssetPipelineCliArguments {
  const commandValue = argv[0];
  if (commandValue !== 'build' && commandValue !== 'check') throw new Error('first argument must be build or check');
  const command: AssetPipelineCommand = commandValue;
  let config: string | undefined;
  let only: string | undefined;
  let outDir: string | undefined;
  let dryRun = false;
  let allowAllOverrides = false;
  const overrides: string[] = [];
  const generations: GenerationId[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--config') {
      config = valueAfter(argv, index, flag);
      index += 1;
    } else if (flag === '--only') {
      only = valueAfter(argv, index, flag);
      index += 1;
    } else if (flag === '--out-dir') {
      outDir = valueAfter(argv, index, flag);
      index += 1;
    } else if (flag === '--set') {
      overrides.push(valueAfter(argv, index, flag));
      index += 1;
    } else if (flag === '--generation') {
      const generation = valueAfter(argv, index, flag);
      if (!(GENERATION_IDS as readonly string[]).includes(generation)) throw new Error(`unknown generation: ${generation}`);
      generations.push(generation as GenerationId);
      index += 1;
    } else if (flag === '--dry-run') {
      dryRun = true;
    } else if (flag === '--allow-all-overrides') {
      allowAllOverrides = true;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (!config) throw new Error('--config is required');
  const common = {
    command,
    config,
    overrides,
    dryRun,
    allowAllOverrides,
    ...(only ? { only } : {}),
    ...(outDir ? { outDir } : {}),
    ...(generations.length > 0 ? { generations } : {}),
  };
  return common;
}
