import type { Vec2 } from '../frame';

export interface AffineUvTransform {
  uvOrigin: Vec2;
  uvStepX: Vec2;
  uvStepY: Vec2;
}

export type SurfaceWrap = 'repeat' | 'clamp';

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
