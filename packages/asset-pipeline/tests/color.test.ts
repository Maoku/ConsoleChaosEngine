import { describe, expect, it } from 'vitest';
import {
  analyzeImage,
  applyBlockPalette,
  applyPalette,
  applyTone,
  blockPaletteSize,
  buildBlockPalette,
  buildPalette,
  chooseFromFixedPalette,
  createImage,
  getPixel,
  medianCut,
  quantizeBinaryAlpha,
  rgb555,
  setPixel,
  validateImage,
  type Rgb,
} from '../src/index';

describe('tone and quantization', () => {
  it('applies floor/gamma and preserves greys under saturation', () => {
    const image = createImage(1, 1, [64, 64, 64, 255]);
    applyTone(image, { gamma: 1, floor: 16, saturation: 2 });
    expect(getPixel(image, 0, 0)).toEqual([76, 76, 76, 255]);
  });

  it('matches RGB555 boundary conversion', () => {
    expect([rgb555(0), rgb555(7), rgb555(8), rgb555(248), rgb555(255)]).toEqual([0, 0, 8, 255, 255]);
  });

  it('builds deterministic median-cut and fixed candidate palettes', () => {
    const pixels: Rgb[] = [[0, 0, 0], [1, 1, 1], [250, 250, 250], [255, 255, 255]];
    expect(medianCut(pixels, 2)).toEqual([[1, 1, 1], [253, 253, 253]]);
    expect(chooseFromFixedPalette(pixels, [[0, 0, 0], [128, 128, 128], [255, 255, 255]], 2)).toEqual([
      [128, 128, 128],
      [0, 0, 0],
    ]);
  });

  it('supports game-owned semantic palette resolvers', () => {
    const image = createImage(2, 1);
    setPixel(image, 0, 0, [30, 10, 10, 127]);
    setPixel(image, 1, 0, [230, 10, 10, 255]);
    const palette = buildPalette(image, {
      colorCount: 2,
      resolver: ([red]) => (red < 128 ? [0, 0, 0] : [255, 255, 255]),
    });
    applyPalette(image, palette, { binaryAlpha: true });
    expect(getPixel(image, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(image, 1, 0)).toEqual([255, 255, 255, 255]);
  });

  it('quantizes alpha independently', () => {
    const image = createImage(2, 1);
    setPixel(image, 0, 0, [1, 2, 3, 127]);
    setPixel(image, 1, 0, [1, 2, 3, 128]);
    quantizeBinaryAlpha(image);
    expect([...image.data]).toEqual([0, 0, 0, 0, 1, 2, 3, 255]);
  });
});

describe('block palettes and validation', () => {
  it('assigns deterministic local palette banks', () => {
    const image = createImage(4, 2);
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) setPixel(image, x, y, [255, 0, 0, 255]);
      for (let x = 2; x < 4; x += 1) setPixel(image, x, y, [0, 0, 255, 255]);
    }
    const palette = buildBlockPalette(image, {
      blockSize: 2,
      banks: 2,
      colorsPerBank: 1,
      shared: [0, 0, 0],
    });
    expect(blockPaletteSize(palette)).toBe(3);
    applyBlockPalette(image, palette);
    expect(getPixel(image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(image, 3, 0)).toEqual([0, 0, 255, 255]);
  });

  it('reports dimensions, colors, alpha mode, and palette membership', () => {
    const image = createImage(2, 1);
    setPixel(image, 0, 0, [1, 2, 3, 0]);
    setPixel(image, 1, 0, [4, 5, 6, 255]);
    expect(analyzeImage(image)).toEqual({
      width: 2,
      height: 1,
      visibleColorCount: 1,
      alphaMode: 'binary',
      alphaValues: [0, 255],
    });
    expect(validateImage(image, { width: 1, palette: [[0, 0, 0]] })).toEqual([
      'width 2 does not match 1',
      'rgb(4,5,6) is not in the required palette',
    ]);
  });
});
