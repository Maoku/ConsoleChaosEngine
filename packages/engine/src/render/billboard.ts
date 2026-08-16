import type { mat4 } from 'gl-matrix';
import type { SpriteCommand } from './frame';

export type BillboardMode = NonNullable<SpriteCommand['billboard']>;

const WORLD_UP: readonly [number, number, number] = [0, 1, 0];

export function spriteDepthWrite(command: SpriteCommand, translucent: boolean): boolean {
  return !command.screenSpace && !translucent && (command.depthWrite ?? true);
}

/** Writes a sprite transform without allocating transient matrices or vectors. */
export function writeSpriteModelMatrix(
  out: mat4,
  command: SpriteCommand,
  cameraPosition: ArrayLike<number>,
  cameraUp: ArrayLike<number> = WORLD_UP,
  billboard: BillboardMode = command.screenSpace ? 'none' : (command.billboard ?? 'cylindrical'),
): mat4 {
  const [px, py, pz] = command.position;
  let rightX = 1;
  let rightY = 0;
  let rightZ = 0;
  let upX = 0;
  let upY = 1;
  let upZ = 0;
  let forwardX = 0;
  let forwardY = 0;
  let forwardZ = 1;
  if (!command.screenSpace && billboard === 'cylindrical') {
    forwardX = (cameraPosition[0] ?? 0) - px;
    forwardZ = (cameraPosition[2] ?? 0) - pz;
    const length = Math.hypot(forwardX, forwardZ);
    if (length > 1e-8) {
      forwardX /= length;
      forwardZ /= length;
    } else {
      forwardX = 0;
      forwardZ = 1;
    }
    rightX = forwardZ;
    rightZ = -forwardX;
  } else if (!command.screenSpace && billboard === 'spherical') {
    forwardX = (cameraPosition[0] ?? 0) - px;
    forwardY = (cameraPosition[1] ?? 0) - py;
    forwardZ = (cameraPosition[2] ?? 0) - pz;
    const forwardLength = Math.hypot(forwardX, forwardY, forwardZ);
    if (forwardLength > 1e-8) {
      forwardX /= forwardLength;
      forwardY /= forwardLength;
      forwardZ /= forwardLength;
    } else {
      forwardX = 0;
      forwardY = 0;
      forwardZ = 1;
    }
    rightX = (cameraUp[1] ?? 1) * forwardZ - (cameraUp[2] ?? 0) * forwardY;
    rightY = (cameraUp[2] ?? 0) * forwardX - (cameraUp[0] ?? 0) * forwardZ;
    rightZ = (cameraUp[0] ?? 0) * forwardY - (cameraUp[1] ?? 1) * forwardX;
    const rightLength = Math.hypot(rightX, rightY, rightZ);
    if (rightLength > 1e-8) {
      rightX /= rightLength;
      rightY /= rightLength;
      rightZ /= rightLength;
    } else {
      rightX = 1;
      rightY = 0;
      rightZ = 0;
    }
    upX = forwardY * rightZ - forwardZ * rightY;
    upY = forwardZ * rightX - forwardX * rightZ;
    upZ = forwardX * rightY - forwardY * rightX;
  }

  const cosine = Math.cos(command.rotation ?? 0);
  const sine = Math.sin(command.rotation ?? 0);
  const rotatedRightX = rightX * cosine + upX * sine;
  const rotatedRightY = rightY * cosine + upY * sine;
  const rotatedRightZ = rightZ * cosine + upZ * sine;
  const rotatedUpX = -rightX * sine + upX * cosine;
  const rotatedUpY = -rightY * sine + upY * cosine;
  const rotatedUpZ = -rightZ * sine + upZ * cosine;
  const scaleX = (command.flipX ? -1 : 1) * command.size[0] / 2;
  // Screen-space uses a top-left origin and a Y-down projection. Negating the
  // local up axis keeps atlas v0 (the image top) on the visual top edge.
  const scaleY = (command.screenSpace ? -1 : 1) * command.size[1] / 2;
  out[0] = rotatedRightX * scaleX;
  out[1] = rotatedRightY * scaleX;
  out[2] = rotatedRightZ * scaleX;
  out[3] = 0;
  out[4] = rotatedUpX * scaleY;
  out[5] = rotatedUpY * scaleY;
  out[6] = rotatedUpZ * scaleY;
  out[7] = 0;
  out[8] = forwardX;
  out[9] = forwardY;
  out[10] = forwardZ;
  out[11] = 0;
  out[12] = px;
  out[13] = py;
  out[14] = pz;
  out[15] = 1;
  return out;
}
