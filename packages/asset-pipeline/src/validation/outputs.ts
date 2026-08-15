import { type AssetClassGenerationSpec } from '../generation/spec';
import { type RgbaImage } from '../image/types';
import { analyzeImage, validateImage } from './image';

export function validateGeneratedImage(image: RgbaImage, spec: AssetClassGenerationSpec): string[] {
  const errors = validateImage(image, {
    width: spec.width,
    height: spec.height,
    maxVisibleColors: spec.colorBudget,
    ...(spec.masterPalette ? { palette: spec.masterPalette } : {}),
  });
  if (spec.binaryAlpha && analyzeImage(image).alphaMode === '8bit') {
    errors.push(`${spec.generation} requires binary alpha`);
  }
  return errors;
}
