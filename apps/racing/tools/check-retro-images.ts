import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { resolve } from 'node:path';

interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const ROOT = resolve(import.meta.dirname, '..');
const SPECS = [
  ['public/assets/gen1/sprites/cars.png', 384, 256, 25, true, false],
  ['public/assets/gen1/backgrounds/coast.png', 512, 192, 24, false, true],
  ['public/assets/gen1/road/road.png', 256, 256, 16, false, true],
  ['public/assets/gen2/sprites/cars.png', 384, 256, 129, true, false],
  ['public/assets/gen2/backgrounds/coast.png', 512, 192, 128, false, true],
  ['public/assets/gen2/tiles/circuit.png', 256, 256, 128, false, true],
] as const;

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance ? left : upDistance <= upperLeftDistance ? up : upperLeft;
}

function decodePng(path: string): DecodedPng {
  const source = readFileSync(path);
  if (source.readUInt32BE(0) !== 0x89504e47 || source.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${path}: invalid PNG signature`);
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const compressed: Buffer[] = [];
  while (offset < source.length) {
    const length = source.readUInt32BE(offset);
    const type = source.toString('ascii', offset + 4, offset + 8);
    const data = source.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') compressed.push(data);
    offset += 12 + length;
  }
  if (bitDepth !== 8 || ![2, 3, 6].includes(colorType)) throw new Error(`${path}: unsupported PNG type ${colorType}/${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const filtered = inflateSync(Buffer.concat(compressed));
  const pixels = new Uint8Array(stride * height);
  let sourceOffset = 0;
  for (let row = 0; row < height; row++) {
    const filter = filtered[sourceOffset++] ?? 0;
    for (let column = 0; column < stride; column++) {
      const encoded = filtered[sourceOffset++] ?? 0;
      const target = row * stride + column;
      const left = column >= channels ? (pixels[target - channels] ?? 0) : 0;
      const up = row > 0 ? (pixels[target - stride] ?? 0) : 0;
      const upperLeft = row > 0 && column >= channels ? (pixels[target - stride - channels] ?? 0) : 0;
      const prediction = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upperLeft)
                : Number.NaN;
      if (!Number.isFinite(prediction)) throw new Error(`${path}: unsupported PNG filter ${filter}`);
      pixels[target] = (encoded + prediction) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (colorType === 6) rgba.set(pixels.subarray(pixel * 4, pixel * 4 + 4), pixel * 4);
    else if (colorType === 2) {
      rgba.set(pixels.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
      rgba[pixel * 4 + 3] = 255;
    } else {
      const index = pixels[pixel] ?? 0;
      rgba[pixel * 4] = palette?.[index * 3] ?? 0;
      rgba[pixel * 4 + 1] = palette?.[index * 3 + 1] ?? 0;
      rgba[pixel * 4 + 2] = palette?.[index * 3 + 2] ?? 0;
      rgba[pixel * 4 + 3] = transparency?.[index] ?? 255;
    }
  }
  return { width, height, rgba };
}

function seamError(image: DecodedPng): readonly [number, number] {
  const { width, height, rgba } = image;
  let topBottom = 0;
  let leftRight = 0;
  for (let x = 0; x < width; x++) {
    for (let channel = 0; channel < 3; channel++) {
      topBottom += Math.abs((rgba[(x * 4) + channel] ?? 0) - (rgba[((height - 1) * width + x) * 4 + channel] ?? 0));
    }
  }
  for (let y = 0; y < height; y++) {
    for (let channel = 0; channel < 3; channel++) {
      leftRight += Math.abs((rgba[(y * width) * 4 + channel] ?? 0) - (rgba[(y * width + width - 1) * 4 + channel] ?? 0));
    }
  }
  return [topBottom / (width * 3), leftRight / (height * 3)];
}

for (const [relative, width, height, colorBudget, needsAlpha, needsHorizontalSeam] of SPECS) {
  const image = decodePng(resolve(ROOT, relative));
  if (image.width !== width || image.height !== height) throw new Error(`${relative}: expected ${width}x${height}`);
  const colors = new Set<number>();
  let transparent = 0;
  for (let pixel = 0; pixel < image.width * image.height; pixel++) {
    const offset = pixel * 4;
    const red = image.rgba[offset] ?? 0;
    const green = image.rgba[offset + 1] ?? 0;
    const blue = image.rgba[offset + 2] ?? 0;
    const alpha = image.rgba[offset + 3] ?? 0;
    colors.add((((red << 24) | (green << 16) | (blue << 8) | alpha) >>> 0));
    if (alpha === 0) transparent++;
  }
  if (colors.size > colorBudget) throw new Error(`${relative}: ${colors.size} colors exceeds ${colorBudget}`);
  if (needsAlpha && transparent < image.width * image.height / 3) throw new Error(`${relative}: transparent atlas gutter is missing`);
  const [topBottom, leftRight] = seamError(image);
  if (needsHorizontalSeam && leftRight > 16) throw new Error(`${relative}: horizontal seam error ${leftRight.toFixed(2)}`);
  if (relative.includes('/road/') || relative.includes('/tiles/')) {
    if (topBottom > 16) throw new Error(`${relative}: vertical seam error ${topBottom.toFixed(2)}`);
  }
  console.log(`✓ ${relative}: ${width}x${height}, colors ${colors.size}, alpha ${transparent}, seams ${topBottom.toFixed(2)}/${leftRight.toFixed(2)}`);
}
