import { bayerThreshold } from './dither';
import { chooseFromFixedPalette, medianCut, nearestColor, samplePixels } from './palette';
import { type Rgb, type RgbaImage } from '../image/types';

export function rgb555(value: number): number {
  return Math.round((Math.min(255, Math.max(0, Math.round(value))) >> 3) * (255 / 31));
}

export function toRgb555(color: Rgb): Rgb {
  return [rgb555(color[0]), rgb555(color[1]), rgb555(color[2])];
}

export function quantizeRgb555(image: RgbaImage): RgbaImage {
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = rgb555(image.data[index] ?? 0);
    image.data[index + 1] = rgb555(image.data[index + 1] ?? 0);
    image.data[index + 2] = rgb555(image.data[index + 2] ?? 0);
  }
  return image;
}

export type PaletteResolver = (
  color: Rgb,
  context: { readonly x: number; readonly y: number; readonly image: RgbaImage },
) => Rgb;

export type QuantizationPalette =
  | { readonly kind: 'truecolor' }
  | { readonly kind: 'palette'; readonly table: readonly Rgb[] }
  | { readonly kind: 'resolver'; readonly resolve: PaletteResolver; readonly colorCount?: number };

export interface BuildPaletteOptions {
  readonly colorCount: number | null;
  readonly candidates?: readonly Rgb[];
  readonly rgb555?: boolean;
  readonly alphaFloor?: number;
  readonly resolver?: PaletteResolver;
}

export function buildPalette(image: RgbaImage, options: BuildPaletteOptions): QuantizationPalette {
  if (options.resolver) {
    return options.colorCount === null
      ? { kind: 'resolver', resolve: options.resolver }
      : { kind: 'resolver', resolve: options.resolver, colorCount: options.colorCount };
  }
  if (options.colorCount === null || options.colorCount === 0) return { kind: 'truecolor' };
  const pixels = samplePixels(image, options.alphaFloor);
  if (pixels.length === 0) return { kind: 'palette', table: [] };
  const sampleStep = Math.max(1, Math.floor(pixels.length / 20_000));
  const sample = sampleStep === 1 ? pixels : pixels.filter((_, index) => index % sampleStep === 0);
  const selected = options.candidates
    ? chooseFromFixedPalette(sample, options.candidates, options.colorCount)
    : medianCut(sample, options.colorCount);
  return { kind: 'palette', table: options.rgb555 ? selected.map(toRgb555) : selected };
}

export function paletteSize(palette: QuantizationPalette): number | null {
  if (palette.kind === 'truecolor') return null;
  if (palette.kind === 'resolver') return palette.colorCount ?? null;
  return palette.table.length;
}

export interface ApplyPaletteOptions {
  readonly binaryAlpha?: boolean;
  readonly alphaThreshold?: number;
  readonly dither?: boolean;
  readonly spread?: number;
}

export function quantizeBinaryAlpha(image: RgbaImage, threshold = 128): RgbaImage {
  for (let index = 0; index < image.data.length; index += 4) {
    if ((image.data[index + 3] ?? 0) < threshold) {
      image.data[index] = 0;
      image.data[index + 1] = 0;
      image.data[index + 2] = 0;
      image.data[index + 3] = 0;
    } else {
      image.data[index + 3] = 255;
    }
  }
  return image;
}

const clamp = (value: number): number => Math.min(255, Math.max(0, value));

export function applyPalette(
  image: RgbaImage,
  palette: QuantizationPalette,
  { binaryAlpha = false, alphaThreshold = 128, dither = false, spread = 24 }: ApplyPaletteOptions = {},
): RgbaImage {
  for (let index = 0; index < image.data.length; index += 4) {
    if (binaryAlpha && (image.data[index + 3] ?? 0) < alphaThreshold) {
      image.data.fill(0, index, index + 4);
      continue;
    }
    if (binaryAlpha) image.data[index + 3] = 255;
    else if (image.data[index + 3] === 0) continue;
    if (palette.kind === 'truecolor') continue;
    const pixel = index / 4;
    const x = pixel % image.width;
    const y = (pixel - x) / image.width;
    let red = image.data[index] ?? 0;
    let green = image.data[index + 1] ?? 0;
    let blue = image.data[index + 2] ?? 0;
    if (dither) {
      const offset = bayerThreshold(x, y) * spread;
      red = clamp(red + offset);
      green = clamp(green + offset);
      blue = clamp(blue + offset);
    }
    const source: Rgb = [red, green, blue];
    const color = palette.kind === 'resolver'
      ? palette.resolve(source, { x, y, image })
      : nearestColor(palette.table, red, green, blue);
    image.data[index] = color[0];
    image.data[index + 1] = color[1];
    image.data[index + 2] = color[2];
  }
  return image;
}
