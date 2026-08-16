import {
  applyPalette,
  applyTone,
  blit,
  buildPalette,
  createImage,
  cropToOpaque,
  defineAssetClass,
  defineAssetPipeline,
  keyOut,
  paletteSize,
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

const recipe = {
  assets: {
    'title-logo': {
      keyOut: false,
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
      matte: { tolerance: 0, isolatedTolerance: 0, fringe: 1 },
    },
    character: {
      keyOut: true,
      padding: { top: 20, right: 16, bottom: 0, left: 16 },
      matte: { tolerance: 120, isolatedTolerance: 88, fringe: 460 },
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
    {
      id: 'character',
      source: 'art/source/character-upper.png',
      assetClass: character,
      outputs: {
        FC: 'public/assets/generated/fc/character.png',
        SFC: 'public/assets/generated/sfc/character.png',
        PS1: 'public/assets/generated/ps1/character.png',
        PS2: 'public/assets/generated/ps2/character.png',
      },
    },
  ],
  build({ asset, generation, source, spec, recipe: activeRecipe }) {
    const assetRecipe = activeRecipe.assets[asset.id];
    if (!assetRecipe) throw new Error(`Missing recipe for ${asset.id}`);
    if (assetRecipe.keyOut) keyOut(source, assetRecipe.matte);
    const opaque = cropToOpaque(source);
    const normalized = padToAspect(opaque, spec.width, spec.height, assetRecipe.padding);
    const image = resample(normalized, spec.width, spec.height);
    applyTone(image, activeRecipe.tone[generation]);
    const palette = buildPalette(image, {
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
