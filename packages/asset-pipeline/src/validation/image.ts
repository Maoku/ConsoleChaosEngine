import { type Rgb, type RgbaImage, type Size } from '../image/types';

export type AlphaMode = 'opaque' | 'binary' | '8bit';

export interface ImageAnalysis extends Size {
  readonly visibleColorCount: number;
  readonly alphaMode: AlphaMode;
  readonly alphaValues: readonly number[];
}

export function visibleColors(image: RgbaImage): Rgb[] {
  const colors = new Map<string, Rgb>();
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3] === 0) continue;
    const color: Rgb = [image.data[index] ?? 0, image.data[index + 1] ?? 0, image.data[index + 2] ?? 0];
    colors.set(color.join(','), color);
  }
  return [...colors.values()];
}

export function alphaValues(image: RgbaImage): number[] {
  const values = new Set<number>();
  for (let index = 3; index < image.data.length; index += 4) values.add(image.data[index] ?? 0);
  return [...values].sort((left, right) => left - right);
}

export function analyzeImage(image: RgbaImage): ImageAnalysis {
  const alphas = alphaValues(image);
  const alphaMode: AlphaMode = alphas.length === 1 && alphas[0] === 255
    ? 'opaque'
    : alphas.every((alpha) => alpha === 0 || alpha === 255)
      ? 'binary'
      : '8bit';
  return {
    width: image.width,
    height: image.height,
    visibleColorCount: visibleColors(image).length,
    alphaMode,
    alphaValues: alphas,
  };
}

export interface ImageConstraints {
  readonly width?: number;
  readonly height?: number;
  readonly maxVisibleColors?: number | null;
  readonly alphaMode?: AlphaMode;
  readonly palette?: readonly Rgb[];
}

export function validateImage(image: RgbaImage, constraints: ImageConstraints): string[] {
  const analysis = analyzeImage(image);
  const errors: string[] = [];
  if (constraints.width !== undefined && image.width !== constraints.width) {
    errors.push(`width ${image.width} does not match ${constraints.width}`);
  }
  if (constraints.height !== undefined && image.height !== constraints.height) {
    errors.push(`height ${image.height} does not match ${constraints.height}`);
  }
  if (constraints.maxVisibleColors !== undefined && constraints.maxVisibleColors !== null && analysis.visibleColorCount > constraints.maxVisibleColors) {
    errors.push(`visible color count ${analysis.visibleColorCount} exceeds ${constraints.maxVisibleColors}`);
  }
  if (constraints.alphaMode !== undefined && analysis.alphaMode !== constraints.alphaMode) {
    errors.push(`alpha mode ${analysis.alphaMode} does not match ${constraints.alphaMode}`);
  }
  if (constraints.palette) {
    const allowed = new Set(constraints.palette.map((color) => color.join(',')));
    for (const color of visibleColors(image)) {
      if (!allowed.has(color.join(','))) errors.push(`rgb(${color.join(',')}) is not in the required palette`);
    }
  }
  return errors;
}

export function assertImageConstraints(image: RgbaImage, constraints: ImageConstraints): void {
  const errors = validateImage(image, constraints);
  if (errors.length > 0) throw new Error(errors.join('; '));
}
