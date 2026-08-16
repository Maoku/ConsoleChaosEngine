import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  analyzeImage,
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
const expectedAssetIds = ['title-logo', ...characterAssetIds];

const expectedSizes = {
  'title-logo': {
    FC: [200, 40],
    SFC: [200, 40],
    PS1: [250, 50],
    PS2: [500, 100],
  },
  character: {
    FC: [120, 144],
    SFC: [130, 156],
    PS1: [150, 180],
    PS2: [280, 336],
  },
} as const;

const colorBudgets = {
  'title-logo': { FC: 4, SFC: 12, PS1: 32, PS2: null },
  character: { FC: 16, SFC: 48, PS1: 96, PS2: null },
} as const;

const errors: string[] = [];
const fail = (condition: boolean, message: string): void => {
  if (!condition) errors.push(message);
};
const colorKey = (color: Rgb): string => color.join(',');
const isCharacter = (assetId: string): boolean => assetId.startsWith('character-');

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

fail(manifest.outputs.length === 40, `manifest must contain 40 outputs, found ${manifest.outputs.length}`);
fail(
  [...new Set(manifest.outputs.map((output) => output.assetId))].sort().join('|') ===
    [...expectedAssetIds].sort().join('|'),
  'manifest asset IDs must be title-logo plus the nine declared character frames',
);
fail(
  [...new Set(manifest.outputs.map((output) => output.sourcePath))].sort().join('|') ===
    ['art/source/character-upper.png', 'art/source/title-logo.png'].join('|'),
  'manifest source paths must be the two art/source inputs',
);

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
    const assetKind = isCharacter(assetId) ? 'character' : 'title-logo';
    const expected = expectedSizes[assetKind][generation];
    fail(
      output.width === expected[0] && output.height === expected[1],
      `${assetId}.${generation}: expected ${expected.join('x')}, found ${output.width}x${output.height}`,
    );
    const budget = colorBudgets[assetKind][generation];
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
    assertTransparentBlack(image, `${assetId}.${generation}`);
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
    if (assetKind === 'character') {
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
fail(fcColors.size <= 20, `FC logo + character frames use ${fcColors.size} colors; expected at most 20`);

for (const generation of GENERATION_IDS) {
  for (const eyes of eyeFrames) {
    const left = imageFor(`character-left-${eyes}`, generation);
    const center = imageFor(`character-center-${eyes}`, generation);
    const right = imageFor(`character-right-${eyes}`, generation);
    fail(left !== null && center !== null && right !== null, `${generation}.${eyes}: missing pose frame`);
    if (left && center && right) {
      fail(!rgbaEqual(left, center), `${generation}.${eyes}: left and center pose frames are identical`);
      fail(!rgbaEqual(center, right), `${generation}.${eyes}: center and right pose frames are identical`);
    }
  }
  const open = imageFor('character-center-open', generation);
  const half = imageFor('character-center-half', generation);
  const closed = imageFor('character-center-closed', generation);
  fail(open !== null && half !== null && closed !== null, `${generation}: missing eye frame`);
  if (open && half && closed) {
    fail(!rgbaEqual(open, half), `${generation}: open and half eye frames are identical`);
    fail(!rgbaEqual(half, closed), `${generation}: half and closed eye frames are identical`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`✗ ${error}`);
  process.exitCode = 1;
} else {
  console.log(`✓ asset contract: 40 outputs, ${fcColors.size} shared FC colors`);
}
