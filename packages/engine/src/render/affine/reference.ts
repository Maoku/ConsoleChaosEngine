import type { AffineSurfaceCommand, Vec2 } from '../frame';

export interface AffineUvTransform {
  uvOrigin: Vec2;
  uvStepX: Vec2;
  uvStepY: Vec2;
}

export type SurfaceWrap = 'repeat' | 'clamp';

export function validateAffineSurface(command: AffineSurfaceCommand, resolution?: Vec2): void {
  const values = [...command.screenRect, ...command.uvOrigin, ...command.uvStepX, ...command.uvStepY];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Affine surface ${command.id} values must be finite`);
  }
  const [left, top, width, height] = command.screenRect;
  if (left < 0 || top < 0 || width <= 0 || height <= 0) {
    throw new Error('Affine surface screenRect must have a non-negative origin and positive size');
  }
  if (resolution && (left + width > resolution[0] || top + height > resolution[1])) {
    throw new Error(`Affine surface ${command.id} lies outside the generation target`);
  }
}

function wrapCoordinate(value: number, wrap: SurfaceWrap): number {
  if (wrap === 'repeat') return value - Math.floor(value);
  return Math.min(Math.max(value, 0), 1);
}

/**
 * CPU reference for the affine-surface shader.
 * `localPixel` is measured from the surface rectangle's top-left corner and
 * refers to a pixel center when each component ends in `.5`.
 */
export function affineUvAt(
  transform: AffineUvTransform,
  localPixel: Vec2,
  wrap: SurfaceWrap = 'repeat',
): Vec2 {
  const u = transform.uvOrigin[0]
    + transform.uvStepX[0] * localPixel[0]
    + transform.uvStepY[0] * localPixel[1];
  const v = transform.uvOrigin[1]
    + transform.uvStepX[1] * localPixel[0]
    + transform.uvStepY[1] * localPixel[1];
  return [wrapCoordinate(u, wrap), wrapCoordinate(v, wrap)];
}
