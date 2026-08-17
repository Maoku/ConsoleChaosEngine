import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  blit,
  createImage,
  crop,
  type AssetPipelineDefinition,
  type JsonObject,
  type RgbaImage,
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
const ps2BodyIds = poses.map((pose) => `character-${pose}-body`);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

interface InclusiveRectWithSize {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly width: number;
  readonly height: number;
}

interface ArtConfigModule {
  readonly default: AssetPipelineDefinition<JsonObject>;
  readonly buildLegacyPs2Frame: (source: RgbaImage) => RgbaImage;
  readonly eyePatchRect: (
    size: { readonly width: number; readonly height: number },
    generation: 'PS2',
    includeFeather?: boolean,
  ) => InclusiveRectWithSize;
}

async function loadConfigModule(): Promise<ArtConfigModule> {
  return await import(pathToFileURL(resolve(projectRoot, 'tools/art.config.mjs')).href) as ArtConfigModule;
}

async function loadDefinition(): Promise<AssetPipelineDefinition<JsonObject>> {
  return (await loadConfigModule()).default;
}

describe('asset pipeline sample contract', () => {
  it('checks PS2 body/face patterns and preserves legacy full-frame pixels through the 10px guard', async () => {
    const config = await loadConfigModule();
    const definition = config.default;
    const result = await runAssetPipeline(definition, { command: 'check', baseDir: projectRoot });
    expect(result.ok, result.differences.join('\n')).toBe(true);
    expect(result.plan).toHaveLength(52);
    expect(new Set(result.plan.map((output) => output.assetId)))
      .toEqual(new Set(['title-logo', ...characterIds, ...ps2BodyIds]));
    for (const assetId of ['title-logo', ...characterIds, ...ps2BodyIds]) {
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

    const fullSizes = {
      FC: [120, 144],
      SFC: [130, 156],
      PS1: [150, 180],
      PS2: [280, 336],
    } as const;
    for (const generation of GENERATION_IDS) {
      const [width, height] = fullSizes[generation];
      const patchPadding = generation === 'PS2' ? 14 : 0;
      const patchWidth = Math.ceil(width * 0.71) - Math.floor(width * 0.29) + patchPadding * 2;
      const patchHeight = Math.ceil(height * 0.39) - Math.floor(height * 0.19) + patchPadding * 2;
      for (const pose of poses) {
        expect(result.manifest?.outputs.find(
          (output) => output.generation === generation && output.assetId === `character-${pose}-open`,
        )).toMatchObject(generation === 'PS2'
          ? { width: patchWidth, height: patchHeight }
          : { width, height });
        for (const eyes of ['half', 'closed'] as const) {
          expect(result.manifest?.outputs.find(
            (output) => output.generation === generation && output.assetId === `character-${pose}-${eyes}`,
          )).toMatchObject({ width: patchWidth, height: patchHeight });
        }
        expect(result.manifest?.outputs.find(
          (output) => output.generation === generation && output.assetId === `character-${pose}-body`,
        )).toMatchObject(generation === 'PS2'
          ? { width, height }
          : { width: 1, height: 1 });
      }
    }

    const ps2FacePatterns = result.manifest?.outputs.filter(
      (output) => output.generation === 'PS2' && characterIds.includes(output.assetId),
    ) ?? [];
    expect(ps2FacePatterns).toHaveLength(9);
    for (const output of ps2FacePatterns) {
      const image = readPng(resolve(projectRoot, output.outputPath));
      expect([image.width, image.height], output.assetId).toEqual([146, 97]);
      expect(Array.from({ length: image.width * image.height }, (_, pixel) => pixel)
        .filter((pixel) => image.data[pixel * 4 + 3] === 0)
        .every((pixel) =>
          (image.data[pixel * 4] ?? 0) === 0 &&
          (image.data[pixel * 4 + 1] ?? 0) === 0 &&
          (image.data[pixel * 4 + 2] ?? 0) === 0
        ), `${output.assetId}: transparent RGB is normalized`).toBe(true);
    }

    const parityRect = config.eyePatchRect({ width: 280, height: 336 }, 'PS2', false);
    const patchRect = config.eyePatchRect({ width: 280, height: 336 }, 'PS2');
    expect(parityRect).toMatchObject({ width: 138, height: 89 });
    expect(patchRect).toMatchObject({ width: 146, height: 97 });
    for (const pose of poses) {
      const body = readPng(resolve(projectRoot, `public/assets/generated/ps2/character-${pose}-body.png`));
      const legacyOpen = config.buildLegacyPs2Frame(
        readPng(resolve(projectRoot, `art/source/character-${pose}-open.png`)),
      );
      const bodyHole = crop(body, parityRect.x0, parityRect.y0, parityRect.x1, parityRect.y1);
      expect(
        Array.from({ length: bodyHole.width * bodyHole.height }, (_, pixel) =>
          bodyHole.data[pixel * 4 + 3]
        ).every((alpha) => alpha === 0),
        `${pose}: body hole must be transparent`,
      ).toBe(true);
      const legacyOpenPatch = crop(
        legacyOpen,
        patchRect.x0,
        patchRect.y0,
        patchRect.x1,
        patchRect.y1,
      );
      for (const eyes of eyeFrames) {
        const patch = readPng(
          resolve(projectRoot, `public/assets/generated/ps2/character-${pose}-${eyes}.png`),
        );
        const legacy = config.buildLegacyPs2Frame(
          readPng(resolve(projectRoot, `art/source/character-${pose}-${eyes}.png`)),
        );
        const composed = createImage(legacy.width, legacy.height);
        blit(composed, body, 0, 0);
        blit(composed, patch, patchRect.x0, patchRect.y0);
        expect(rgbaEqual(
          crop(composed, parityRect.x0, parityRect.y0, parityRect.x1, parityRect.y1),
          crop(legacy, parityRect.x0, parityRect.y0, parityRect.x1, parityRect.y1),
        ), `${pose}/${eyes}: 10px parity region differs from legacy full-frame display`).toBe(true);

        const borderPairs = [
          [crop(patch, 0, 0, patch.width - 1, 0), crop(legacyOpenPatch, 0, 0, patch.width - 1, 0)],
          [
            crop(patch, 0, patch.height - 1, patch.width - 1, patch.height - 1),
            crop(legacyOpenPatch, 0, patch.height - 1, patch.width - 1, patch.height - 1),
          ],
          [crop(patch, 0, 0, 0, patch.height - 1), crop(legacyOpenPatch, 0, 0, 0, patch.height - 1)],
          [
            crop(patch, patch.width - 1, 0, patch.width - 1, patch.height - 1),
            crop(legacyOpenPatch, patch.width - 1, 0, patch.width - 1, patch.height - 1),
          ],
        ] as const;
        expect(
          borderPairs.every(([actual, expected]) => rgbaEqual(actual, expected)),
          `${pose}/${eyes}: outer feather border must equal the open body`,
        ).toBe(true);
      }
    }

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
    expect(configSource).not.toMatch(/\b(?:maskEyeDifferences|differenceFocus|differenceFloor|differenceCeiling|expandPixels)\b/);
    expect(configSource).toContain('function maskEyeWindows');
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
    expect(first.written).toHaveLength(53);
    expect(second.written).toEqual([]);
    expect((await runAssetPipeline(definition, { command: 'check', baseDir: root })).ok).toBe(true);
  }, 60_000);
});
