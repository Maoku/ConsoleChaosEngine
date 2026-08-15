import { crop } from './geometry';
import { chroma, luma, type RgbaImage } from './types';

export function cropToOpaque(image: RgbaImage): RgbaImage {
  let x0 = image.width;
  let y0 = image.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) throw new Error('image has no visible pixels');
  return crop(image, x0, y0, x1, y1);
}

export interface TrimHaloOptions {
  readonly passes?: number;
  readonly minLuma?: number;
  readonly maxChroma?: number;
}

export function trimHalo(
  image: RgbaImage,
  { passes = 3, minLuma = 170, maxChroma = 34 }: TrimHaloOptions = {},
): number {
  let removed = 0;
  for (let pass = 0; pass < passes; pass += 1) {
    const doomed: number[] = [];
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const pixel = y * image.width + x;
        if (image.data[pixel * 4 + 3] === 0) continue;
        const edge =
          x === 0 ||
          y === 0 ||
          x === image.width - 1 ||
          y === image.height - 1 ||
          image.data[(pixel - 1) * 4 + 3] === 0 ||
          image.data[(pixel + 1) * 4 + 3] === 0 ||
          image.data[(pixel - image.width) * 4 + 3] === 0 ||
          image.data[(pixel + image.width) * 4 + 3] === 0;
        if (!edge) continue;
        const index = pixel * 4;
        const red = image.data[index] ?? 0;
        const green = image.data[index + 1] ?? 0;
        const blue = image.data[index + 2] ?? 0;
        if (luma(red, green, blue) >= minLuma && chroma(red, green, blue) <= maxChroma) doomed.push(pixel);
      }
    }
    if (doomed.length === 0) break;
    for (const pixel of doomed) image.data[pixel * 4 + 3] = 0;
    removed += doomed.length;
  }
  return removed;
}

export interface KeyOutOptions {
  readonly tolerance?: number;
  readonly isolatedTolerance?: number;
  readonly fringe?: number;
}

export function keyOut(
  image: RgbaImage,
  { tolerance = 60, isolatedTolerance = 45, fringe = 200 }: KeyOutOptions = {},
): void {
  const key = [image.data[0] ?? 0, image.data[1] ?? 0, image.data[2] ?? 0] as const;
  const distance = (index: number): number =>
    Math.abs((image.data[index] ?? 0) - key[0]) +
    Math.abs((image.data[index + 1] ?? 0) - key[1]) +
    Math.abs((image.data[index + 2] ?? 0) - key[2]);
  const background = new Uint8Array(image.width * image.height);
  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
    const pixel = y * image.width + x;
    if (background[pixel] || distance(pixel * 4) > tolerance) return;
    background[pixel] = 1;
    stack.push(pixel);
  };
  for (let x = 0; x < image.width; x += 1) {
    push(x, 0);
    push(x, image.height - 1);
  }
  for (let y = 0; y < image.height; y += 1) {
    push(0, y);
    push(image.width - 1, y);
  }
  while (stack.length > 0) {
    const pixel = stack.pop();
    if (pixel === undefined) break;
    const x = pixel % image.width;
    const y = (pixel - x) / image.width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  for (let pixel = 0; pixel < background.length; pixel += 1) {
    if (!background[pixel] && distance(pixel * 4) <= isolatedTolerance) background[pixel] = 1;
  }
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixel = y * image.width + x;
      const index = pixel * 4;
      if (background[pixel]) {
        image.data[index + 3] = 0;
        continue;
      }
      image.data[index + 3] = 255;
      const pixelDistance = distance(index);
      if (pixelDistance >= fringe) continue;
      let touching = false;
      for (let deltaY = -2; deltaY <= 2 && !touching; deltaY += 1) {
        for (let deltaX = -2; deltaX <= 2; deltaX += 1) {
          const neighborX = x + deltaX;
          const neighborY = y + deltaY;
          if (neighborX < 0 || neighborY < 0 || neighborX >= image.width || neighborY >= image.height) continue;
          if (background[neighborY * image.width + neighborX]) {
            touching = true;
            break;
          }
        }
      }
      if (!touching) continue;
      const alpha = pixelDistance / fringe;
      for (let channel = 0; channel < 3; channel += 1) {
        const unmixed = ((image.data[index + channel] ?? 0) - (key[channel] ?? 0) * (1 - alpha)) / alpha;
        image.data[index + channel] = Math.min(Math.max(Math.round(unmixed), 0), 255);
      }
      image.data[index + 3] = Math.round(alpha * 255);
    }
  }
}
