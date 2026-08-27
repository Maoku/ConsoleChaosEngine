/**
 * カメラ（§3）。
 *
 * 世界は常に 3D で 1 つ（不変条件 I1）。2D 世代は「正射影で見る」だけであり、
 * カメラ自体は同じ位置・同じ注視点を保つ。投影方法の違いは projection の型だけで表す。
 */
import { mat4, vec3 } from 'gl-matrix';
import type { CameraCommand } from './frame';

export type CameraProjection = 'perspective' | 'ortho';

export const DEFAULT_CAMERA_FOV_DEGREES = 55;
export const DEFAULT_CAMERA_NEAR = 0.1;
export const DEFAULT_CAMERA_FAR = 200;
export const DEFAULT_CAMERA_UP = [0, 1, 0] as const;

export interface Camera {
  projection: CameraProjection;
  /** 透視投影の垂直画角（度） */
  fovDegrees: number;
  /** 正射影の縦方向の可視範囲（ワールド単位） */
  orthoHeight: number;
  near: number;
  far: number;
  position: vec3;
  target: vec3;
  up: vec3;
  readonly view: mat4;
  readonly projectionMatrix: mat4;
  readonly viewProjection: mat4;
  /** 行列を再計算する。1 ティックに 1 回だけ呼ぶ */
  update(aspect: number): void;
}

export function createCamera(projection: CameraProjection = 'perspective'): Camera {
  const view = mat4.create();
  const projectionMatrix = mat4.create();
  const viewProjection = mat4.create();

  return {
    projection,
    fovDegrees: DEFAULT_CAMERA_FOV_DEGREES,
    orthoHeight: 8,
    near: DEFAULT_CAMERA_NEAR,
    far: DEFAULT_CAMERA_FAR,
    position: vec3.fromValues(0, 2, 8),
    target: vec3.fromValues(0, 1, 0),
    up: vec3.fromValues(...DEFAULT_CAMERA_UP),
    view,
    projectionMatrix,
    viewProjection,
    update(aspect: number): void {
      mat4.lookAt(view, this.position, this.target, this.up);
      if (this.projection === 'perspective') {
        mat4.perspective(projectionMatrix, (this.fovDegrees * Math.PI) / 180, aspect, this.near, this.far);
      } else {
        const halfH = this.orthoHeight / 2;
        const halfW = halfH * aspect;
        mat4.ortho(projectionMatrix, -halfW, halfW, -halfH, halfH, this.near, this.far);
      }
      mat4.multiply(viewProjection, projectionMatrix, view);
    },
  };
}

/** Applies a frame command and resets omitted optional values to their defaults. */
export function applyCameraCommand(camera: Camera, command: CameraCommand, aspect: number): void {
  const near = command.near ?? DEFAULT_CAMERA_NEAR;
  const far = command.far ?? DEFAULT_CAMERA_FAR;
  if (!Number.isFinite(near) || near <= 0) throw new RangeError(`camera.near must be finite and greater than 0; received ${near}`);
  if (!Number.isFinite(far) || far <= near) throw new RangeError(`camera.far must be finite and greater than near (${near}); received ${far}`);
  camera.projection = command.projection === 'orthographic' ? 'ortho' : 'perspective';
  camera.orthoHeight = command.orthoHeight ?? command.zoom;
  camera.fovDegrees = command.fovDegrees ?? DEFAULT_CAMERA_FOV_DEGREES;
  camera.near = near;
  camera.far = far;
  for (let axis = 0; axis < 3; axis++) {
    camera.position[axis] = command.position[axis]!;
    camera.target[axis] = command.target[axis]!;
    camera.up[axis] = command.up?.[axis] ?? DEFAULT_CAMERA_UP[axis]!;
  }
  camera.update(aspect);
}

/** Projects a world point into viewport pixels, returning null outside the depth clip range. */
export function projectCameraPoint(
  camera: Camera,
  point: readonly [number, number, number],
  width: number,
  height: number,
): readonly [number, number] | null {
  const matrix = camera.viewProjection;
  const [x, y, z] = point;
  const clipX = matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!;
  const clipY = matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!;
  const clipZ = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!;
  const clipW = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
  if (!Number.isFinite(clipW) || clipW <= 1e-8) return null;
  const ndcZ = clipZ / clipW;
  if (ndcZ < -1 || ndcZ > 1) return null;
  return [
    (clipX / clipW * 0.5 + 0.5) * width,
    (0.5 - clipY / clipW * 0.5) * height,
  ];
}
