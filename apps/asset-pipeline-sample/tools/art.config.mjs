import {
  applyPalette,
  applyTone,
  blit,
  buildPalette,
  cloneImage,
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

const POSES = ['left', 'center', 'right'];
const EYE_FRAMES = ['open', 'half', 'closed'];
const POSE_AMOUNT = { left: -1, center: 0, right: 1 };

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

function sampleBilinear(image, sourceX, sourceY) {
  const x0 = Math.floor(sourceX);
  const y0 = Math.floor(sourceY);
  const xFraction = sourceX - x0;
  const yFraction = sourceY - y0;
  const samples = [
    [x0, y0, (1 - xFraction) * (1 - yFraction)],
    [x0 + 1, y0, xFraction * (1 - yFraction)],
    [x0, y0 + 1, (1 - xFraction) * yFraction],
    [x0 + 1, y0 + 1, xFraction * yFraction],
  ];
  let alpha = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (const [x, y, weight] of samples) {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
    const index = (y * image.width + x) * 4;
    const sampleAlpha = (image.data[index + 3] ?? 0) / 255;
    const weightedAlpha = sampleAlpha * weight;
    alpha += weightedAlpha;
    red += (image.data[index] ?? 0) * weightedAlpha;
    green += (image.data[index + 1] ?? 0) * weightedAlpha;
    blue += (image.data[index + 2] ?? 0) * weightedAlpha;
  }
  if (alpha <= 0) return [0, 0, 0, 0];
  return [
    Math.round(red / alpha),
    Math.round(green / alpha),
    Math.round(blue / alpha),
    Math.round(Math.min(alpha, 1) * 255),
  ];
}

function warp(image, sourcePosition) {
  const output = createImage(image.width, image.height);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const [sourceX, sourceY] = sourcePosition(x, y);
      output.data.set(sampleBilinear(image, sourceX, sourceY), (y * image.width + x) * 4);
    }
  }
  return output;
}

function blinkWarp(image, eyes) {
  const strength = eyes === 'half' ? 0.5 : eyes === 'closed' ? 0.84 : 0;
  if (strength === 0) return cloneImage(image);
  const centers = [0.403, 0.574];
  const centerY = image.height * 0.292;
  const radiusX = image.width * 0.065;
  const radiusY = image.height * 0.061;
  return warp(image, (x, y) => {
    let sourceY = y;
    for (const centerFraction of centers) {
      const centerX = image.width * centerFraction;
      const normalizedX = Math.abs(x - centerX) / radiusX;
      const normalizedY = Math.abs(y - centerY) / radiusY;
      if (normalizedX >= 1 || normalizedY >= 1) continue;
      const horizontalWeight = 0.5 + 0.5 * Math.cos(normalizedX * Math.PI);
      const scale = Math.max(1 - strength * horizontalWeight, 0.12);
      const offset = Math.min(Math.max((y - centerY) / scale, -radiusY), radiusY);
      sourceY = centerY + offset;
      break;
    }
    return [x, sourceY];
  });
}

function motionWarp(image, pose, generation) {
  const amount = POSE_AMOUNT[pose];
  if (amount === 0) return cloneImage(image);
  const bakeBodyPose = generation === 'FC' || generation === 'SFC';
  return warp(image, (x, y) => {
    const normalizedX = x / Math.max(image.width - 1, 1);
    const normalizedY = y / Math.max(image.height - 1, 1);
    const bodyShift = bakeBodyPose
      ? amount * image.width * 0.045 * (1 - normalizedY)
      : 0;
    const tailX = (normalizedX - 0.235) / 0.235;
    const tailY = (normalizedY - 0.285) / 0.27;
    const tailRadius = tailX * tailX + tailY * tailY;
    const tailWeight = tailRadius < 1
      ? 0.5 + 0.5 * Math.cos(Math.sqrt(tailRadius) * Math.PI)
      : 0;
    const tailShift = -amount * image.width * 0.055 * tailWeight;
    return [x - bodyShift - tailShift, y];
  });
}

function normalizedCharacter(source, spec, activeRecipe) {
  const assetRecipe = activeRecipe.assets.character;
  keyOut(source, assetRecipe.matte);
  const opaque = cropToOpaque(source);
  const normalized = padToAspect(opaque, spec.width, spec.height, assetRecipe.padding);
  return resample(normalized, spec.width, spec.height);
}

function characterFrameFor(assetId) {
  const frame = characterFrames.find((candidate) => candidate.id === assetId);
  if (!frame) throw new Error(`Unknown character frame: ${assetId}`);
  return frame;
}

const characterAssets = characterFrames.map((frame) => ({
  id: frame.id,
  source: 'art/source/character-upper.png',
  assetClass: character,
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
      const frame = characterFrameFor(asset.id);
      const canonical = normalizedCharacter(source, spec, activeRecipe);
      image = motionWarp(blinkWarp(canonical, frame.eyes), frame.pose, generation);
      paletteSource = canonical;
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
