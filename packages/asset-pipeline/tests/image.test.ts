import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  cloneImage,
  createImage,
  crop,
  cropToOpaque,
  decodePng,
  encodePng,
  flipVertical,
  getPixel,
  keyOut,
  resample,
  resampleCover,
  rgbaEqual,
  setPixel,
  shrinkByMode,
  trimHalo,
} from '../src/index';

function uncheckedChunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  return Buffer.concat([length, Buffer.from(type, 'ascii'), payload, Buffer.alloc(4)]);
}

function rgbPng(red: number, green: number, blue: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    uncheckedChunk('IHDR', header),
    uncheckedChunk('IDAT', deflateSync(Buffer.from([0, red, green, blue]))),
    uncheckedChunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('PNG codec', () => {
  it('round-trips RGBA8 and expands RGB8 to opaque RGBA', () => {
    const image = createImage(2, 1);
    setPixel(image, 0, 0, [1, 2, 3, 4]);
    setPixel(image, 1, 0, [250, 240, 230, 255]);
    expect(rgbaEqual(decodePng(encodePng(image)), image)).toBe(true);
    expect(getPixel(decodePng(rgbPng(9, 8, 7)), 0, 0)).toEqual([9, 8, 7, 255]);
  });

  it('rejects unsupported depth, color type, and interlace', () => {
    const encoded = encodePng(createImage(1, 1));
    const depth = Buffer.from(encoded);
    depth[24] = 16;
    expect(() => decodePng(depth)).toThrow(/bit depth/);
    const colorType = Buffer.from(encoded);
    colorType[25] = 3;
    expect(() => decodePng(colorType)).toThrow(/color type/);
    const interlaced = Buffer.from(encoded);
    interlaced[28] = 1;
    expect(() => decodePng(interlaced)).toThrow(/interlaced/);
  });
});

describe('image geometry and resampling', () => {
  it('does not bleed RGB from transparent pixels during area resampling', () => {
    const source = createImage(2, 1);
    setPixel(source, 0, 0, [255, 0, 0, 255]);
    setPixel(source, 1, 0, [0, 0, 255, 0]);
    expect(getPixel(resample(source, 1, 1), 0, 0)).toEqual([255, 0, 0, 128]);
  });

  it('cover-crops from the center and supports inclusive crop coordinates', () => {
    const source = createImage(4, 2);
    for (let x = 0; x < 4; x += 1) {
      setPixel(source, x, 0, [x, 0, 0, 255]);
      setPixel(source, x, 1, [x, 0, 0, 255]);
    }
    const covered = resampleCover(source, 2, 2);
    expect(getPixel(covered, 0, 0)[0]).toBe(1);
    expect(getPixel(covered, 1, 0)[0]).toBe(2);
    expect(crop(source, 1, 0, 2, 1)).toMatchObject({ width: 2, height: 2 });
  });

  it('uses brighter luma as the deterministic mode tie-break', () => {
    const source = createImage(2, 2);
    setPixel(source, 0, 0, [20, 20, 20, 255]);
    setPixel(source, 1, 0, [200, 200, 200, 255]);
    setPixel(source, 0, 1, [20, 20, 20, 255]);
    setPixel(source, 1, 1, [200, 200, 200, 255]);
    expect(getPixel(shrinkByMode(source, 2), 0, 0)).toEqual([200, 200, 200, 255]);
  });

  it('flips rows without changing the source', () => {
    const source = createImage(1, 2);
    setPixel(source, 0, 0, [1, 0, 0, 255]);
    setPixel(source, 0, 1, [2, 0, 0, 255]);
    const flipped = flipVertical(source);
    expect(getPixel(flipped, 0, 0)[0]).toBe(2);
    expect(getPixel(source, 0, 0)[0]).toBe(1);
  });
});

describe('matte cleanup', () => {
  it('crops to visible bounds and removes only low-chroma bright halo pixels', () => {
    const image = createImage(5, 3);
    setPixel(image, 1, 1, [240, 240, 240, 255]);
    setPixel(image, 2, 1, [240, 120, 120, 255]);
    setPixel(image, 3, 1, [10, 10, 10, 255]);
    const cropped = cropToOpaque(image);
    expect(cropped).toMatchObject({ width: 3, height: 1 });
    const mutable = cloneImage(cropped);
    expect(trimHalo(mutable, { passes: 1 })).toBe(1);
    expect(getPixel(mutable, 0, 0)[3]).toBe(0);
    expect(getPixel(mutable, 1, 0)[3]).toBe(255);
  });

  it('flood-fills a connected key color without removing an isolated subject', () => {
    const image = createImage(3, 3, [255, 255, 255, 255]);
    setPixel(image, 1, 1, [0, 0, 0, 255]);
    keyOut(image, { tolerance: 0, isolatedTolerance: 0, fringe: 1 });
    expect(getPixel(image, 0, 0)[3]).toBe(0);
    expect(getPixel(image, 1, 1)).toEqual([0, 0, 0, 255]);
  });
});
