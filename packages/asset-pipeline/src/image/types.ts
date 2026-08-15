export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface InclusiveRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function assertImage(image: RgbaImage): void {
  if (!Number.isInteger(image.width) || image.width <= 0) throw new Error(`invalid image width: ${image.width}`);
  if (!Number.isInteger(image.height) || image.height <= 0) throw new Error(`invalid image height: ${image.height}`);
  const expected = image.width * image.height * 4;
  if (image.data.length !== expected) {
    throw new Error(`invalid RGBA length: expected ${expected}, received ${image.data.length}`);
  }
}

export function createImage(width: number, height: number, fill: Rgba = [0, 0, 0, 0]): RgbaImage {
  const image: RgbaImage = { width, height, data: new Uint8Array(width * height * 4) };
  assertImage(image);
  if (fill.some((component) => component !== 0)) {
    for (let index = 0; index < image.data.length; index += 4) image.data.set(fill, index);
  }
  return image;
}

export function cloneImage(source: RgbaImage): RgbaImage {
  assertImage(source);
  return { width: source.width, height: source.height, data: new Uint8Array(source.data) };
}

export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function chroma(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

export function getPixel(image: RgbaImage, x: number, y: number): Rgba {
  const index = (y * image.width + x) * 4;
  return [
    image.data[index] ?? 0,
    image.data[index + 1] ?? 0,
    image.data[index + 2] ?? 0,
    image.data[index + 3] ?? 0,
  ];
}

export function setPixel(image: RgbaImage, x: number, y: number, rgba: Rgba): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  image.data.set(rgba, (y * image.width + x) * 4);
}
