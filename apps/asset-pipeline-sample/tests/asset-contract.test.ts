import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AssetPipelineDefinition,
  type JsonObject,
  readPng,
  rgbaEqual,
  runAssetPipeline,
  sha256,
} from '@console-chaos/asset-pipeline';
import { GENERATION_IDS } from '@console-chaos/engine';

const projectRoot = resolve(import.meta.dirname, '..');
const temporaryDirectories: string[] = [];
const poses = ['left', 'center', 'right'] as const;
const eyeFrames = ['open', 'half', 'closed'] as const;
const characterIds = poses.flatMap((pose) =>
  eyeFrames.map((eyes) => `character-${pose}-${eyes}`),
);

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
    expect(new Set(result.plan.map((output) => output.assetId)))
      .toEqual(new Set(['title-logo', ...characterIds]));
    for (const assetId of ['title-logo', ...characterIds]) {
      expect(result.plan.filter((output) => output.assetId === assetId).map((output) => output.generation))
        .toEqual(GENERATION_IDS);
    }

    const characterPlan = result.plan.filter((output) => output.assetId.startsWith('character-'));
    expect(new Set(characterPlan.map((output) => output.sourcePath)))
      .toEqual(new Set(characterIds.map((assetId) => `art/source/${assetId}.png`)));
    expect(characterPlan.some((output) => output.sourcePath.endsWith('character-upper.png'))).toBe(false);
    expect(result.manifest).toBeDefined();
    const characterHashes = new Set(
      result.manifest?.outputs
        .filter((output) => output.assetId.startsWith('character-'))
        .map((output) => output.sourceSha256),
    );
    expect(characterHashes.size).toBe(9);

    const provenance = readFileSync(resolve(projectRoot, 'Docs/ASSET_PROVENANCE.md'), 'utf8');
    for (const assetId of characterIds) {
      const sourcePath = resolve(projectRoot, `art/source/${assetId}.png`);
      const source = readPng(sourcePath);
      expect([source.width, source.height], assetId).toEqual([1024, 1536]);
      expect(provenance, assetId).toContain(sha256(readFileSync(sourcePath)));
    }
    for (const eyes of eyeFrames) {
      const left = readPng(resolve(projectRoot, `art/source/character-left-${eyes}.png`));
      const center = readPng(resolve(projectRoot, `art/source/character-center-${eyes}.png`));
      const right = readPng(resolve(projectRoot, `art/source/character-right-${eyes}.png`));
      expect(rgbaEqual(left, center), `${eyes}: left and center source differ`).toBe(false);
      expect(rgbaEqual(center, right), `${eyes}: center and right source differ`).toBe(false);
    }
    for (const pose of poses) {
      const open = readPng(resolve(projectRoot, `art/source/character-${pose}-open.png`));
      const half = readPng(resolve(projectRoot, `art/source/character-${pose}-half.png`));
      const closed = readPng(resolve(projectRoot, `art/source/character-${pose}-closed.png`));
      expect(rgbaEqual(open, half), `${pose}: open and half source differ`).toBe(false);
      expect(rgbaEqual(half, closed), `${pose}: half and closed source differ`).toBe(false);
    }

    const configSource = readFileSync(resolve(projectRoot, 'tools/art.config.mjs'), 'utf8');
    expect(configSource).not.toMatch(/\b(?:blinkWarp|motionWarp|sampleBilinear|shear)\b|function\s+warp\b/);
  }, 60_000);

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
