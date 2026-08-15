import { type RgbaImage } from '../image/types';
import { type Rgb } from '../image/types';

export interface ToneOptions {
  readonly gamma?: number;
  readonly floor?: number;
  readonly saturation?: number;
}

const clampByte = (value: number): number => Math.min(Math.max(Math.round(value), 0), 255);

/** Applies gamma/floor first and then expands saturation around the luma axis. */
export function applyTone(
  image: RgbaImage,
  { gamma = 1, floor = 0, saturation = 1 }: ToneOptions = {},
): RgbaImage {
  if (!(gamma > 0)) throw new Error(`gamma must be positive: ${gamma}`);
  if (floor < 0 || floor > 255) throw new Error(`floor must be in 0..255: ${floor}`);
  if (saturation < 0) throw new Error(`saturation must not be negative: ${saturation}`);
  const table = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    table[value] = clampByte(floor + (255 - floor) * (value / 255) ** gamma);
  }
  for (let index = 0; index < image.data.length; index += 4) {
    const red = table[image.data[index] ?? 0] ?? 0;
    const green = table[image.data[index + 1] ?? 0] ?? 0;
    const blue = table[image.data[index + 2] ?? 0] ?? 0;
    const grey = 0.299 * red + 0.587 * green + 0.114 * blue;
    image.data[index] = clampByte(grey + (red - grey) * saturation);
    image.data[index + 1] = clampByte(grey + (green - grey) * saturation);
    image.data[index + 2] = clampByte(grey + (blue - grey) * saturation);
  }
  return image;
}

export const tone = applyTone;

/** Maps visible RGB colors while preserving alpha and normalizing transparent pixels to clear black. */
export function mapRgb(image: RgbaImage, map: (color: Rgb) => Rgb): RgbaImage {
  const data = new Uint8Array(image.data.length);
  const cache = new Map<string, Rgb>();
  for (let index = 0; index < image.data.length; index += 4) {
    const alpha = image.data[index + 3] ?? 0;
    data[index + 3] = alpha;
    if (alpha === 0) continue;
    const color: Rgb = [image.data[index] ?? 0, image.data[index + 1] ?? 0, image.data[index + 2] ?? 0];
    const key = color.join(',');
    let mapped = cache.get(key);
    if (!mapped) {
      mapped = map(color);
      cache.set(key, mapped);
    }
    data[index] = mapped[0];
    data[index + 1] = mapped[1];
    data[index + 2] = mapped[2];
  }
  return { width: image.width, height: image.height, data };
}
