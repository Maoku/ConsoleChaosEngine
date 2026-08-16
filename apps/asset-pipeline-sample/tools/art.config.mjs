import { resolve } from 'node:path';
import {
  applyPalette,
  applyTone,
  blit,
  buildPalette,
  cloneImage,
  createImage,
  crop,
  cropToOpaque,
  defineAssetClass,
  defineAssetPipeline,
  keyOut,
  paletteSize,
  readPng,
  resample,
} from '@console-chaos/asset-pipeline';

const generationSizes = {
  'title-logo': {
    FC: { width: 200, height: 40 },
    SFC: { width: 200, height: 40 },
    PS1: { width: 250, height: 50 },
    PS2: { width: 500, height: 100 },
  },
  character: {
    FC: { width: 120, height: 144 },
    SFC: { width: 130, height: 156 },
    PS1: { width: 150, height: 180 },
    PS2: { width: 280, height: 336 },
  },
};

const POSES = ['left', 'center', 'right'];
const EYE_FRAMES = ['open', 'half', 'closed'];

// Kept in normalized character space so every generation crops the same face area.
// The patch includes enough surrounding skin/hair to fully cover the open-eye base.
const EYE_PATCH_REGION = { left: 0.29, top: 0.19, right: 0.71, bottom: 0.39 };

function eyePatchRect(size) {
  const x0 = Math.floor(size.width * EYE_PATCH_REGION.left);
  const y0 = Math.floor(size.height * EYE_PATCH_REGION.top);
  const x1 = Math.ceil(size.width * EYE_PATCH_REGION.right) - 1;
  const y1 = Math.ceil(size.height * EYE_PATCH_REGION.bottom) - 1;
  return { x0, y0, x1, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

const characterFrames = POSES.flatMap((pose) =>
  EYE_FRAMES.map((eyes) => ({
    id: `character-${pose}-${eyes}`,
    pose,
    eyes,
  })),
);

const titleLogo = defineAssetClass({
  id: 'title-logo',
  colorBudget: { FC: 4, SFC: 12, PS1: 32, PS2: null },
  targetSize: (generation) => generationSizes['title-logo'][generation],
});

const character = defineAssetClass({
  id: 'character',
  colorBudget: { FC: 16, SFC: 48, PS1: 96, PS2: null },
  targetSize: (generation) => generationSizes.character[generation],
});

const characterEyeVariant = defineAssetClass({
  id: 'character-eye-variant',
  colorBudget: { FC: 16, SFC: 48, PS1: 96, PS2: null },
  targetSize: (generation) => generation === 'PS2'
    ? generationSizes.character[generation]
    : eyePatchRect(generationSizes.character[generation]),
});

const recipe = {
  assets: {
    'title-logo': {
      keyOut: false,
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
      matte: { tolerance: 0, isolatedTolerance: 0, fringe: 1 },
    },
    character: {
      keyOut: true,
      sourceCanvas: { width: 1024, height: 1536 },
      crop: { x0: 31, y0: 47, x1: 992, y1: 1535 },
      padding: { top: 20, right: 16, bottom: 0, left: 16 },
      matte: { tolerance: 120, isolatedTolerance: 88, fringe: 460 },
    },
    eyePatch: {
      region: EYE_PATCH_REGION,
      // Use two semantic eye windows instead of pixel differences. ImageGen
      // frames contain tiny alignment/shading drift that must never become a
      // translucent second copy of the bangs, cheeks, or nose.
      windows: [
        { centerX: 0.34, centerY: 0.46, radiusX: 0.17, radiusY: 0.22 },
        { centerX: 0.66, centerY: 0.46, radiusX: 0.17, radiusY: 0.22 },
      ],
      featherPixels: { FC: 1, SFC: 1, PS1: 1, PS2: 2 },
    },
  },
  tone: {
    FC: { gamma: 0.94, floor: 0, saturation: 1.08 },
    SFC: { gamma: 0.98, floor: 0, saturation: 1.04 },
    PS1: { gamma: 1, floor: 0, saturation: 1 },
    PS2: { gamma: 1, floor: 0, saturation: 1 },
  },
  palette: {
    FC: { dither: false, spread: 0, alphaThreshold: 136 },
    SFC: { dither: true, spread: 8, alphaThreshold: 128 },
    PS1: { dither: false, spread: 0, alphaThreshold: 112 },
    PS2: { dither: false, spread: 0, alphaThreshold: 1 },
  },
};

function padToAspect(image, targetWidth, targetHeight, padding) {
  const padded = createImage(
    image.width + padding.left + padding.right,
    image.height + padding.top + padding.bottom,
  );
  blit(padded, image, padding.left, padding.top);

  const targetAspect = targetWidth / targetHeight;
  const currentAspect = padded.width / padded.height;
  const width = currentAspect < targetAspect
    ? Math.ceil(padded.height * targetAspect)
    : padded.width;
  const height = currentAspect > targetAspect
    ? Math.ceil(padded.width / targetAspect)
    : padded.height;
  const normalized = createImage(width, height);
  const x = Math.floor((width - padded.width) / 2);
  const y = Math.floor((height - padded.height) / 2);
  blit(normalized, padded, x, y);
  return normalized;
}

function normalizeTransparentPixels(image) {
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3] !== 0) continue;
    image.data[index] = 0;
    image.data[index + 1] = 0;
    image.data[index + 2] = 0;
  }
  return image;
}

function normalizedCharacter(source, spec, activeRecipe) {
  const assetRecipe = activeRecipe.assets.character;
  if (
    source.width !== assetRecipe.sourceCanvas.width ||
    source.height !== assetRecipe.sourceCanvas.height
  ) {
    throw new Error(
      `Character source canvas must be ${assetRecipe.sourceCanvas.width}x${assetRecipe.sourceCanvas.height}`,
    );
  }
  keyOut(source, assetRecipe.matte);
  const fixed = crop(
    source,
    assetRecipe.crop.x0,
    assetRecipe.crop.y0,
    assetRecipe.crop.x1,
    assetRecipe.crop.y1,
  );
  const normalized = padToAspect(fixed, spec.width, spec.height, assetRecipe.padding);
  return resample(normalized, spec.width, spec.height);
}

function maskEyeWindows(image, options) {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let amount = 0;
      for (const window of options.windows) {
        const radiusX = image.width * window.radiusX;
        const radiusY = image.height * window.radiusY;
        const deltaX = (x + 0.5 - image.width * window.centerX) / radiusX;
        const deltaY = (y + 0.5 - image.height * window.centerY) / radiusY;
        const distance = Math.hypot(deltaX, deltaY);
        const feather = options.featherPixels / Math.min(radiusX, radiusY);
        const edge = Math.min(Math.max((1 + feather - distance) / feather, 0), 1);
        const eased = edge * edge * (3 - 2 * edge);
        amount = Math.max(amount, eased);
      }
      const alphaIndex = (y * image.width + x) * 4 + 3;
      image.data[alphaIndex] = Math.round((image.data[alphaIndex] ?? 0) * amount);
    }
  }

  let visiblePixels = 0;
  for (let index = 3; index < image.data.length; index += 4) {
    if ((image.data[index] ?? 0) > 0) visiblePixels += 1;
  }
  if (visiblePixels === 0) throw new Error('Eye patch windows have no visible pixels');
  return image;
}

const canonicalCharacter = readPng(
  resolve(import.meta.dirname, '../art/source/character-center-open.png'),
);
const characterAssets = characterFrames.map((frame) => ({
  id: frame.id,
  source: `art/source/${frame.id}.png`,
  // PS2 uses all nine authored frames as full-body key textures so it never
  // needs translucent eye-patch composition. Earlier generations keep the
  // optimized cropped eye variants.
  assetClass: frame.eyes === 'open' ? character : characterEyeVariant,
  outputs: {
    FC: `public/assets/generated/fc/${frame.id}.png`,
    SFC: `public/assets/generated/sfc/${frame.id}.png`,
    PS1: `public/assets/generated/ps1/${frame.id}.png`,
    PS2: `public/assets/generated/ps2/${frame.id}.png`,
  },
}));

export default defineAssetPipeline({
  rootDir: '..',
  recipe,
  manifestPath: 'public/assets/generated/asset-manifest.json',
  assets: [
    {
      id: 'title-logo',
      source: 'art/source/title-logo.png',
      assetClass: titleLogo,
      outputs: {
        FC: 'public/assets/generated/fc/title-logo.png',
        SFC: 'public/assets/generated/sfc/title-logo.png',
        PS1: 'public/assets/generated/ps1/title-logo.png',
        PS2: 'public/assets/generated/ps2/title-logo.png',
      },
    },
    ...characterAssets,
  ],
  build({ asset, generation, source, spec, recipe: activeRecipe }) {
    const assetRecipe = asset.id === 'title-logo'
      ? activeRecipe.assets['title-logo']
      : activeRecipe.assets.character;
    if (!assetRecipe) throw new Error(`Missing recipe for ${asset.id}`);
    let image;
    let paletteSource;
    if (asset.id === 'title-logo') {
      const opaque = cropToOpaque(source);
      const normalized = padToAspect(opaque, spec.width, spec.height, assetRecipe.padding);
      image = resample(normalized, spec.width, spec.height);
      paletteSource = image;
    } else {
      const fullCharacterSpec = generationSizes.character[generation];
      const isEyePatch = !asset.id.endsWith('-open');
      const normalized = normalizedCharacter(source, fullCharacterSpec, activeRecipe);
      if (isEyePatch && generation !== 'PS2') {
        const patch = eyePatchRect(fullCharacterSpec);
        image = crop(normalized, patch.x0, patch.y0, patch.x1, patch.y1);
        maskEyeWindows(image, {
          windows: activeRecipe.assets.eyePatch.windows,
          featherPixels: activeRecipe.assets.eyePatch.featherPixels[generation],
        });
      } else {
        image = normalized;
      }
      paletteSource = generation === 'FC'
        ? normalizedCharacter(cloneImage(canonicalCharacter), fullCharacterSpec, activeRecipe)
        : image;
    }
    applyTone(image, activeRecipe.tone[generation]);
    if (paletteSource !== image) applyTone(paletteSource, activeRecipe.tone[generation]);
    const palette = buildPalette(paletteSource, {
      colorCount: spec.colorBudget,
      ...(spec.masterPalette ? { candidates: spec.masterPalette } : {}),
      rgb555: spec.rgb555,
    });
    const paletteRecipe = activeRecipe.palette[generation];
    applyPalette(image, palette, {
      binaryAlpha: spec.binaryAlpha,
      alphaThreshold: paletteRecipe.alphaThreshold,
      dither: paletteRecipe.dither,
      spread: paletteRecipe.spread,
    });
    normalizeTransparentPixels(image);
    return { image, paletteCount: paletteSize(palette) };
  },
});
