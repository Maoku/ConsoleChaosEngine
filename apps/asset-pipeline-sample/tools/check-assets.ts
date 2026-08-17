import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  analyzeImage,
  keyOut,
  readPng,
  rgbaEqual,
  toRgb555,
  visibleColors,
  type AssetManifest,
  type Rgb,
  type RgbaImage,
} from '@console-chaos/asset-pipeline';
import {
  GENERATION_IDS,
  MASTER_PALETTE_RGB,
  type GenerationId,
} from '@console-chaos/engine';

const root = resolve(import.meta.dirname, '..');
const generatedRoot = resolve(root, 'public/assets/generated');
const manifest = JSON.parse(
  readFileSync(resolve(generatedRoot, 'asset-manifest.json'), 'utf8'),
) as AssetManifest;

const poses = ['left', 'center', 'right'] as const;
const eyeFrames = ['open', 'half', 'closed'] as const;
const characterAssetIds = poses.flatMap((pose) =>
  eyeFrames.map((eyes) => `character-${pose}-${eyes}` as const),
);
const bodyAssetIds = poses.map((pose) => `character-${pose}-open` as const);
const ps2BodyAssetIds = poses.map((pose) => `character-${pose}-body` as const);
const eyePatchAssetIds = poses.flatMap((pose) =>
  (['half', 'closed'] as const).map((eyes) => `character-${pose}-${eyes}` as const),
);
const expectedAssetIds = ['title-logo', ...characterAssetIds, ...ps2BodyAssetIds];

const logoSizes = {
  FC: [200, 40],
  SFC: [200, 40],
  PS1: [250, 50],
  PS2: [500, 100],
} as const;

const characterSizes = {
  FC: [120, 144],
  SFC: [130, 156],
  PS1: [150, 180],
  PS2: [280, 336],
} as const;

const colorBudgets = {
  'title-logo': { FC: 4, SFC: 12, PS1: 32, PS2: null },
  character: { FC: 16, SFC: 48, PS1: 96, PS2: null },
  'ps2-body': { FC: 1, SFC: 1, PS1: 1, PS2: null },
} as const;

const errors: string[] = [];
const fail = (condition: boolean, message: string): void => {
  if (!condition) errors.push(message);
};
const colorKey = (color: Rgb): string => color.join(',');
const isEyePatch = (assetId: string): boolean =>
  eyePatchAssetIds.includes(assetId as (typeof eyePatchAssetIds)[number]);
const isCharacterFrame = (assetId: string): boolean =>
  characterAssetIds.includes(assetId as (typeof characterAssetIds)[number]);
const isPs2Body = (assetId: string): boolean =>
  ps2BodyAssetIds.includes(assetId as (typeof ps2BodyAssetIds)[number]);

function patchSize(generation: GenerationId): readonly [number, number] {
  const [width, height] = characterSizes[generation];
  const padding = generation === 'PS2' ? 14 : 0;
  return [
    Math.ceil(width * 0.71) - Math.floor(width * 0.29) + padding * 2,
    Math.ceil(height * 0.39) - Math.floor(height * 0.19) + padding * 2,
  ];
}

function assertTransparentBlack(image: RgbaImage, label: string): void {
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3] !== 0) continue;
    const clear = image.data[index] === 0 && image.data[index + 1] === 0 && image.data[index + 2] === 0;
    if (!clear) {
      errors.push(`${label}: transparent RGB is not clear black`);
      return;
    }
  }
}

function opaqueBounds(image: RgbaImage): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = image.width;
  let y0 = image.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

function imageFor(assetId: string, generation: GenerationId): RgbaImage | null {
  const output = manifest.outputs.find(
    (candidate) => candidate.assetId === assetId && candidate.generation === generation,
  );
  return output ? readPng(resolve(root, output.outputPath)) : null;
}

fail(manifest.outputs.length === 52, `manifest must contain 52 outputs, found ${manifest.outputs.length}`);
fail(
  [...new Set(manifest.outputs.map((output) => output.assetId))].sort().join('|') ===
    [...expectedAssetIds].sort().join('|'),
  'manifest asset IDs must be title-logo, nine face states, and three PS2 helper bodies',
);
fail(
  [...new Set(manifest.outputs.map((output) => output.sourcePath))].sort().join('|') ===
    ['art/source/title-logo.png', ...characterAssetIds.map((assetId) => `art/source/${assetId}.png`)]
      .sort()
      .join('|'),
  'manifest source paths must be the logo and nine matching character inputs',
);

const provenance = readFileSync(resolve(root, 'Docs/ASSET_PROVENANCE.md'), 'utf8');
const configSource = readFileSync(resolve(root, 'tools/art.config.mjs'), 'utf8');
fail(
  !/\b(?:blinkWarp|motionWarp|sampleBilinear|shear)\b|function\s+warp\b/.test(configSource),
  'art config must not synthesize animation with warp or shear code',
);
const sourceHashes = new Set<string>();
const sourceImages = new Map<string, RgbaImage>();
for (const assetId of characterAssetIds) {
  const outputs = manifest.outputs.filter((output) => output.assetId === assetId);
  const expectedSourcePath = `art/source/${assetId}.png`;
  fail(
    outputs.length === GENERATION_IDS.length && outputs.every((output) => output.sourcePath === expectedSourcePath),
    `${assetId}: manifest source must be ${expectedSourcePath}`,
  );
  const hashes = new Set(outputs.map((output) => output.sourceSha256));
  fail(hashes.size === 1, `${assetId}: generations must share one source hash`);
  const hash = [...hashes][0];
  if (hash) {
    sourceHashes.add(hash);
    fail(provenance.includes(hash), `${assetId}: source hash is missing from provenance`);
  }

  const source = readPng(resolve(root, expectedSourcePath));
  fail(source.width === 1024 && source.height === 1536, `${assetId}: source canvas must be 1024x1536`);
  keyOut(source, { tolerance: 120, isolatedTolerance: 88, fringe: 460 });
  const bounds = opaqueBounds(source);
  fail(bounds !== null, `${assetId}: keyed source bounds are empty`);
  if (bounds) {
    fail(bounds.x0 >= 31 && bounds.x1 <= 992, `${assetId}: source exceeds the shared horizontal crop`);
    fail(bounds.y0 >= 47 && bounds.y1 === 1535, `${assetId}: source must preserve the shared bottom pivot`);
  }
  sourceImages.set(assetId, source);
}
fail(sourceHashes.size === characterAssetIds.length, 'character source hashes must be unique per asset ID');

for (const eyes of eyeFrames) {
  const left = sourceImages.get(`character-left-${eyes}`);
  const center = sourceImages.get(`character-center-${eyes}`);
  const right = sourceImages.get(`character-right-${eyes}`);
  fail(left !== undefined && center !== undefined && right !== undefined, `${eyes}: missing keyed source pose`);
  if (left && center && right) {
    fail(!rgbaEqual(left, center), `${eyes}: left and center keyed sources are identical`);
    fail(!rgbaEqual(center, right), `${eyes}: center and right keyed sources are identical`);
  }
}
for (const pose of poses) {
  const open = sourceImages.get(`character-${pose}-open`);
  const half = sourceImages.get(`character-${pose}-half`);
  const closed = sourceImages.get(`character-${pose}-closed`);
  fail(open !== undefined && half !== undefined && closed !== undefined, `${pose}: missing keyed source eye frame`);
  if (open && half && closed) {
    fail(!rgbaEqual(open, half), `${pose}: open and half keyed sources are identical`);
    fail(!rgbaEqual(half, closed), `${pose}: half and closed keyed sources are identical`);
  }
}

const fcColors = new Set<string>();
const masterPalette = new Set(MASTER_PALETTE_RGB.map(colorKey));
for (const assetId of expectedAssetIds) {
  for (const generation of GENERATION_IDS) {
    const output = manifest.outputs.find(
      (candidate) => candidate.assetId === assetId && candidate.generation === generation,
    );
    if (!output) {
      errors.push(`${assetId}.${generation}: missing manifest output`);
      continue;
    }
    const expected = assetId === 'title-logo'
      ? logoSizes[generation]
      : isPs2Body(assetId)
        ? generation === 'PS2'
          ? characterSizes[generation]
          : [1, 1] as const
        : isEyePatch(assetId) || (generation === 'PS2' && isCharacterFrame(assetId))
          ? patchSize(generation)
          : characterSizes[generation];
    fail(
      output.width === expected[0] && output.height === expected[1],
      `${assetId}.${generation}: expected ${expected.join('x')}, found ${output.width}x${output.height}`,
    );
    const budget = colorBudgets[
      assetId === 'title-logo' ? 'title-logo' : isPs2Body(assetId) ? 'ps2-body' : 'character'
    ][generation];
    fail(budget === null || output.visibleColorCount <= budget, `${assetId}.${generation}: color budget exceeded`);
    fail(
      generation === 'FC'
        ? output.paletteMode === 'fixed54'
        : generation === 'SFC'
          ? output.paletteMode === 'rgb555'
          : output.paletteMode === 'truecolor',
      `${assetId}.${generation}: unexpected palette mode ${output.paletteMode}`,
    );
    fail(
      generation === 'PS2' ? output.alphaMode === '8bit' : output.alphaMode === 'binary',
      `${assetId}.${generation}: unexpected alpha mode ${output.alphaMode}`,
    );

    const image = readPng(resolve(root, output.outputPath));
    const analysis = analyzeImage(image);
    fail(analysis.visibleColorCount === output.visibleColorCount, `${assetId}.${generation}: manifest color count differs`);
    if (!(generation === 'PS2' && isPs2Body(assetId))) {
      assertTransparentBlack(image, `${assetId}.${generation}`);
    }
    const colors = visibleColors(image);
    if (generation === 'FC') {
      for (const color of colors) {
        fcColors.add(colorKey(color));
        fail(masterPalette.has(colorKey(color)), `${assetId}.FC: rgb(${colorKey(color)}) is outside master palette`);
      }
    }
    if (generation === 'SFC') {
      for (const color of colors) {
        fail(colorKey(toRgb555(color)) === colorKey(color), `${assetId}.SFC: rgb(${colorKey(color)}) is not RGB555`);
      }
    }
    if (
      (generation !== 'PS2' && bodyAssetIds.includes(assetId as (typeof bodyAssetIds)[number])) ||
      (generation === 'PS2' && isPs2Body(assetId))
    ) {
      const bounds = opaqueBounds(image);
      fail(bounds !== null, `${assetId}.${generation}: opaque bounds are empty`);
      if (bounds) {
        fail(bounds.x0 > 0 && bounds.x1 < image.width - 1, `${assetId}.${generation}: side silhouette is clipped`);
        fail(bounds.y0 > 0, `${assetId}.${generation}: ears are clipped`);
        fail(bounds.y1 === image.height - 1, `${assetId}.${generation}: waist does not reach the pivot edge`);
      }
    }
  }
}
fail(fcColors.size <= 20, `FC logo + character assets use ${fcColors.size} colors; expected at most 20`);

for (const generation of GENERATION_IDS) {
  for (const assetId of eyePatchAssetIds) {
    fail(imageFor(assetId, generation) !== null, `${assetId}.${generation}: missing eye variant`);
  }
  for (const pose of poses) {
    const open = imageFor(`character-${pose}-open`, generation);
    const half = imageFor(`character-${pose}-half`, generation);
    const closed = imageFor(`character-${pose}-closed`, generation);
    const ps2Body = imageFor(`character-${pose}-body`, generation);
    fail(open !== null && half !== null && closed !== null, `${generation}.${pose}: missing eye-state frame`);
    fail(ps2Body !== null, `${generation}.${pose}: missing PS2 body helper`);
    if (open && half && closed && ps2Body) {
      if (generation === 'PS2') {
        fail(
          ps2Body.width === characterSizes.PS2[0] && ps2Body.height === characterSizes.PS2[1],
          `${generation}.${pose}: helper body must keep full character dimensions`,
        );
        fail(
          open.width === 146 && open.height === 97 &&
          half.width === open.width && half.height === open.height &&
          closed.width === open.width && closed.height === open.height,
          `${generation}.${pose}: eye states must be cropped face patterns`,
        );
      } else {
        fail(half.width < open.width && half.height < open.height, `${generation}.${pose}: eye patch is not cropped`);
        fail(ps2Body.width === 1 && ps2Body.height === 1, `${generation}.${pose}: helper placeholder must be 1x1`);
      }
      fail(!rgbaEqual(half, closed), `${generation}.${pose}: half and closed eye variants are identical`);
    }
  }
  const left = imageFor('character-left-open', generation);
  const center = imageFor('character-center-open', generation);
  const right = imageFor('character-right-open', generation);
  fail(left !== null && center !== null && right !== null, `${generation}: missing body pose`);
  if (left && center && right) {
    fail(!rgbaEqual(left, center), `${generation}: left and center bodies are identical`);
    fail(!rgbaEqual(center, right), `${generation}: center and right bodies are identical`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`✗ ${error}`);
  process.exitCode = 1;
} else {
  console.log(`✓ asset contract: PS2 body/face patterns + legacy parity guard, ${fcColors.size} shared FC colors`);
}
