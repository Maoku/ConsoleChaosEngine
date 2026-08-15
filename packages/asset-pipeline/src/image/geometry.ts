import {
  assertImage,
  createImage,
  getPixel,
  setPixel,
  type InclusiveRect,
  type RgbaImage,
} from './types';

/** Inclusive-coordinate crop. Pixels outside the source are transparent. */
export function crop(image: RgbaImage, x0: number, y0: number, x1: number, y1: number): RgbaImage {
  assertImage(image);
  if (x1 < x0 || y1 < y0) throw new Error(`invalid crop rectangle: ${x0},${y0}..${x1},${y1}`);
  const output = createImage(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const sourceX = x0 + x;
      const sourceY = y0 + y;
      if (sourceX < 0 || sourceY < 0 || sourceX >= image.width || sourceY >= image.height) continue;
      setPixel(output, x, y, getPixel(image, sourceX, sourceY));
    }
  }
  return output;
}

export function cropTop(image: RgbaImage, fraction: number): RgbaImage {
  if (!(fraction > 0 && fraction <= 1)) throw new Error(`cropTop fraction must be in (0, 1]: ${fraction}`);
  return crop(image, 0, 0, image.width - 1, Math.round(image.height * fraction) - 1);
}

/** Copies non-transparent source pixels into the destination without blending. */
export function blit(
  destination: RgbaImage,
  source: RgbaImage,
  destinationX: number,
  destinationY: number,
  rect: InclusiveRect = { x0: 0, y0: 0, x1: source.width - 1, y1: source.height - 1 },
): void {
  assertImage(destination);
  assertImage(source);
  for (let y = rect.y0; y <= rect.y1; y += 1) {
    for (let x = rect.x0; x <= rect.x1; x += 1) {
      if (x < 0 || y < 0 || x >= source.width || y >= source.height) continue;
      const pixel = getPixel(source, x, y);
      if (pixel[3] === 0) continue;
      setPixel(destination, destinationX + x, destinationY + y, pixel);
    }
  }
}

export function flipVertical(image: RgbaImage): RgbaImage {
  assertImage(image);
  const stride = image.width * 4;
  const data = new Uint8Array(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    data.set(image.data.subarray(y * stride, (y + 1) * stride), (image.height - 1 - y) * stride);
  }
  return { width: image.width, height: image.height, data };
}
