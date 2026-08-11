/**
 * カメラ（§3）。
 *
 * 世界は常に 3D で 1 つ（不変条件 I1）。2D 世代は「正射影で見る」だけであり、
 * カメラ自体は同じ位置・同じ注視点を保つ。投影方法の違いは projection の型だけで表す。
 */
import { mat4, vec3 } from 'gl-matrix';

export type CameraProjection = 'perspective' | 'ortho';

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
    fovDegrees: 55,
    orthoHeight: 8,
    near: 0.1,
    far: 200,
    position: vec3.fromValues(0, 2, 8),
    target: vec3.fromValues(0, 1, 0),
    up: vec3.fromValues(0, 1, 0),
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
