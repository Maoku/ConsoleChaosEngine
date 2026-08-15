import { bayerThreshold } from './dither';
import { chooseFromFixedPalette, colorDistance, medianCut, nearestColor } from './palette';
import { toRgb555 } from './quantize';
import { luma, type Rgb, type RgbaImage } from '../image/types';

export interface BlockPalette {
  readonly kind: 'blocks';
  readonly blockSize: number;
  readonly columns: number;
  readonly tables: readonly (readonly Rgb[])[];
  readonly assignment: Int32Array;
  readonly shared: Rgb;
}

export interface BuildBlockPaletteOptions {
  readonly blockSize: number;
  readonly banks: number;
  readonly colorsPerBank: number;
  readonly shared: Rgb;
  readonly candidates?: readonly Rgb[];
  readonly rgb555?: boolean;
  readonly rounds?: number;
}

interface ColorBlock {
  readonly pixels: Rgb[];
  readonly mean: Rgb;
}

function paletteError(table: readonly Rgb[], pixels: readonly Rgb[]): number {
  let sum = 0;
  for (const pixel of pixels) {
    const color = nearestColor(table, pixel[0], pixel[1], pixel[2]);
    sum += colorDistance(color, pixel[0], pixel[1], pixel[2]);
  }
  return sum;
}

export function buildBlockPalette(image: RgbaImage, options: BuildBlockPaletteOptions): BlockPalette {
  const { blockSize, banks, colorsPerBank, shared } = options;
  if (!Number.isInteger(blockSize) || blockSize <= 0) throw new Error(`invalid block size: ${blockSize}`);
  if (!Number.isInteger(banks) || banks <= 0) throw new Error(`invalid palette bank count: ${banks}`);
  if (!Number.isInteger(colorsPerBank) || colorsPerBank <= 0) {
    throw new Error(`invalid colors per palette bank: ${colorsPerBank}`);
  }
  const columns = Math.ceil(image.width / blockSize);
  const rows = Math.ceil(image.height / blockSize);
  const blocks: ColorBlock[] = [];
  for (let blockY = 0; blockY < rows; blockY += 1) {
    for (let blockX = 0; blockX < columns; blockX += 1) {
      const pixels: Rgb[] = [];
      for (let y = blockY * blockSize; y < Math.min((blockY + 1) * blockSize, image.height); y += 1) {
        for (let x = blockX * blockSize; x < Math.min((blockX + 1) * blockSize, image.width); x += 1) {
          const index = (y * image.width + x) * 4;
          pixels.push([image.data[index] ?? 0, image.data[index + 1] ?? 0, image.data[index + 2] ?? 0]);
        }
      }
      const sum = pixels.reduce<[number, number, number]>(
        (total, pixel) => [total[0] + pixel[0], total[1] + pixel[1], total[2] + pixel[2]],
        [0, 0, 0],
      );
      blocks.push({
        pixels,
        mean: [sum[0] / pixels.length, sum[1] / pixels.length, sum[2] / pixels.length],
      });
    }
  }
  const sorted = blocks
    .map((block, index) => ({ index, key: luma(block.mean[0], block.mean[1], block.mean[2]) }))
    .sort((left, right) => left.key - right.key || left.index - right.index);
  const assignment = new Int32Array(blocks.length);
  for (let index = 0; index < sorted.length; index += 1) {
    const blockIndex = sorted[index]?.index;
    if (blockIndex !== undefined) assignment[blockIndex] = Math.min(Math.floor((index * banks) / sorted.length), banks - 1);
  }

  let tables: Rgb[][] = [];
  for (let round = 0; round < (options.rounds ?? 6); round += 1) {
    tables = [];
    for (let bank = 0; bank < banks; bank += 1) {
      const pixels: Rgb[] = [];
      blocks.forEach((block, blockIndex) => {
        if (assignment[blockIndex] === bank) pixels.push(...block.pixels);
      });
      if (pixels.length === 0) {
        tables.push([shared]);
        continue;
      }
      const sampleStep = Math.max(1, Math.floor(pixels.length / 6000));
      const sample = sampleStep === 1 ? pixels : pixels.filter((_, index) => index % sampleStep === 0);
      const colors = options.candidates
        ? chooseFromFixedPalette(sample, options.candidates, colorsPerBank)
        : medianCut(sample, colorsPerBank).map((color) => (options.rgb555 ? toRgb555(color) : color));
      tables.push([shared, ...colors]);
    }
    let moved = 0;
    blocks.forEach((block, blockIndex) => {
      let bestBank = assignment[blockIndex] ?? 0;
      let bestError = Infinity;
      tables.forEach((table, bank) => {
        const error = paletteError(table, block.pixels);
        if (error < bestError) {
          bestError = error;
          bestBank = bank;
        }
      });
      if (bestBank !== assignment[blockIndex]) moved += 1;
      assignment[blockIndex] = bestBank;
    });
    if (moved === 0) break;
  }
  return { kind: 'blocks', blockSize, columns, tables, assignment, shared };
}

export interface ApplyBlockPaletteOptions {
  readonly dither?: boolean;
  readonly spread?: number;
}

export function applyBlockPalette(
  image: RgbaImage,
  palette: BlockPalette,
  { dither = false, spread = 16 }: ApplyBlockPaletteOptions = {},
): RgbaImage {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4;
      const assignmentIndex = Math.floor(y / palette.blockSize) * palette.columns + Math.floor(x / palette.blockSize);
      const bank = palette.assignment[assignmentIndex] ?? 0;
      const table = palette.tables[bank];
      if (!table || table.length === 0) throw new Error(`block palette bank ${bank} is empty`);
      let red = image.data[index] ?? 0;
      let green = image.data[index + 1] ?? 0;
      let blue = image.data[index + 2] ?? 0;
      if (dither) {
        const offset = bayerThreshold(x, y) * spread;
        red = Math.min(Math.max(red + offset, 0), 255);
        green = Math.min(Math.max(green + offset, 0), 255);
        blue = Math.min(Math.max(blue + offset, 0), 255);
      }
      const color = nearestColor(table, red, green, blue);
      image.data[index] = color[0];
      image.data[index + 1] = color[1];
      image.data[index + 2] = color[2];
      image.data[index + 3] = 255;
    }
  }
  return image;
}

export function blockPaletteSize(palette: BlockPalette): number {
  const colors = new Set<string>();
  for (const table of palette.tables) for (const color of table) colors.add(color.join(','));
  return colors.size;
}
