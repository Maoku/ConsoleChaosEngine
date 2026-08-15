import {
  applyPalette,
  buildPalette,
  defineAssetClass,
  defineAssetPipeline,
  resample,
} from '@console-chaos/asset-pipeline';

const example = defineAssetClass({
  id: 'example',
  colorBudget: { FC: 4, SFC: 16, PS1: 256, PS2: null },
  targetSize: (generation) => ({ FC: 64, SFC: 64, PS1: 128, PS2: 256 })[generation],
});

export default defineAssetPipeline({
  rootDir: '..',
  recipe: {
    tone: { dither: false, spread: 0 },
  },
  manifestPath: 'assets/generated/manifest.json',
  assets: [
    {
      id: 'example',
      source: 'assets/source/example.png',
      assetClass: example,
      outputs: {
        FC: 'assets/generated/example-fc.png',
        SFC: 'assets/generated/example-sfc.png',
        PS1: 'assets/generated/example-ps1.png',
        PS2: 'assets/generated/example-ps2.png',
      },
    },
  ],
  build({ source, spec, recipe }) {
    const image = resample(source, spec.width, spec.height);
    const palette = buildPalette(image, {
      colorCount: spec.colorBudget,
      ...(spec.masterPalette ? { candidates: spec.masterPalette } : {}),
      rgb555: spec.rgb555,
    });
    applyPalette(image, palette, {
      binaryAlpha: spec.binaryAlpha,
      dither: recipe.tone.dither,
      spread: recipe.tone.spread,
    });
    return image;
  },
});
