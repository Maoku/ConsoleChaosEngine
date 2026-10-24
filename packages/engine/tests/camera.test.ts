import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAMERA_FAR,
  DEFAULT_CAMERA_FOV_DEGREES,
  DEFAULT_CAMERA_NEAR,
  DEFAULT_CAMERA_UP,
  applyCameraCommand,
  createCamera,
  projectCameraPoint,
} from '../src/render/camera';
import type { CameraCommand } from '../src/render/frame';

const BASE_COMMAND: CameraCommand = {
  projection: 'perspective',
  position: [1, 2, 3],
  target: [4, 5, 6],
  zoom: 8,
};

describe('camera commands', () => {
  it('applies explicit near and far clipping planes', () => {
    const camera = createCamera();

    applyCameraCommand(camera, { ...BASE_COMMAND, near: 2, far: 750, up: [0, 0, 1] }, 16 / 9);

    expect(camera.near).toBe(2);
    expect(camera.far).toBe(750);
    expect([...camera.position]).toEqual([1, 2, 3]);
    expect([...camera.target]).toEqual([4, 5, 6]);
    expect([...camera.up]).toEqual([0, 0, 1]);
  });

  it('restores camera defaults when optional command values are omitted', () => {
    const camera = createCamera();
    applyCameraCommand(camera, {
      ...BASE_COMMAND,
      fovDegrees: 80,
      near: 3,
      far: 900,
    }, 1);

    applyCameraCommand(camera, BASE_COMMAND, 1);

    expect(camera.fovDegrees).toBe(DEFAULT_CAMERA_FOV_DEGREES);
    expect(camera.near).toBe(DEFAULT_CAMERA_NEAR);
    expect(camera.far).toBe(DEFAULT_CAMERA_FAR);
    expect([...camera.up]).toEqual(DEFAULT_CAMERA_UP);
  });

  it('projects with the configured perspective and rejects points outside near/far', () => {
    const camera = createCamera();
    applyCameraCommand(camera, {
      projection: 'perspective',
      position: [0, 0, 0],
      target: [0, 0, -1],
      zoom: 8,
      fovDegrees: 60,
      near: 2,
      far: 10,
    }, 1);

    expect(projectCameraPoint(camera, [0, 0, -1], 100, 100)).toBeNull();
    expect(projectCameraPoint(camera, [0, 0, -5], 100, 100)).toEqual([50, 50]);
    expect(projectCameraPoint(camera, [0, 0, -11], 100, 100)).toBeNull();
  });

  it('rejects invalid clipping ranges', () => {
    const camera = createCamera();
    expect(() => applyCameraCommand(camera, { ...BASE_COMMAND, near: 0 }, 1)).toThrow(RangeError);
    expect(() => applyCameraCommand(camera, { ...BASE_COMMAND, near: 10, far: 10 }, 1)).toThrow(RangeError);
  });
});
