import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AssetPipelineDefinition,
  type JsonObject,
  runAssetPipeline,
} from '@console-chaos/asset-pipeline';
import { GENERATION_IDS } from '@console-chaos/engine';

const projectRoot = resolve(import.meta.dirname, '..');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function loadDefinition(): Promise<AssetPipelineDefinition<JsonObject>> {
  const module = await import(pathToFileURL(resolve(projectRoot, 'tools/art.config.mjs')).href);
  return module.default as AssetPipelineDefinition<JsonObject>;
}

describe('asset pipeline sample contract', () => {
  it('checks the committed forty-output animation asset set through the public runner', async () => {
    const definition = await loadDefinition();
    const result = await runAssetPipeline(definition, { command: 'check', baseDir: projectRoot });
    expect(result.ok, result.differences.join('\n')).toBe(true);
    expect(result.plan).toHaveLength(40);
    const characterIds = ['left', 'center', 'right'].flatMap((pose) =>
      ['open', 'half', 'closed'].map((eyes) => `character-${pose}-${eyes}`),
    );
    expect(new Set(result.plan.map((output) => output.assetId)))
      .toEqual(new Set(['title-logo', ...characterIds]));
    for (const assetId of ['title-logo', ...characterIds]) {
      expect(result.plan.filter((output) => output.assetId === assetId).map((output) => output.generation))
        .toEqual(GENERATION_IDS);
    }
  }, 20_000);

  it('writes the first fresh build once and writes nothing on the second build', async () => {
    const definition = await loadDefinition();
    const root = await mkdtemp(join(tmpdir(), 'asset-pipeline-sample-'));
    temporaryDirectories.push(root);
    for (const source of definition.assets.map((asset) => asset.source)) {
      const destination = resolve(root, source);
      await mkdir(dirname(destination), { recursive: true });
      await cp(resolve(projectRoot, source), destination);
    }

    const first = await runAssetPipeline(definition, { command: 'build', baseDir: root });
    const second = await runAssetPipeline(definition, { command: 'build', baseDir: root });
    expect(first.written).toHaveLength(41);
    expect(second.written).toEqual([]);
    expect((await runAssetPipeline(definition, { command: 'check', baseDir: root })).ok).toBe(true);
  }, 60_000);
});
