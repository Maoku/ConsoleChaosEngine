import type { AffineSurfaceCommand, CameraCommand } from '@console-chaos/engine';
import type { GardenState } from '@/gameplay/puzzles/affine-garden';

/** Invert the same XY pose used by the island; coordinates are CH2 internal pixels. */
export function gardenSurface(id: string, state: GardenState, camera: CameraCommand): AffineSurfaceCommand {
  const width = 256, height = 224;
  const k = height / (camera.orthoHeight ?? 7);
  const cx = camera.position[0], cy = camera.target[1];
  const span = 12;
  const c = Math.cos(state.angle), s = Math.sin(state.angle);
  const uv = (px: number, py: number): [number, number] => {
    const x = cx + (px - width / 2) / k - state.center[0];
    const y = cy - (py - height / 2) / k - state.center[1];
    return [0.5 + (c * x + s * y) / (state.scale * span),
      0.5 + (-s * x + c * y) / (state.scale * span)];
  };
  const size = span * k;
  const rawLeft = width / 2 + (state.center[0] - cx) * k - size / 2;
  const rawTop = height / 2 - (state.center[1] - cy) * k - size / 2;
  const left = Math.max(0, rawLeft), top = Math.max(0, rawTop);
  const rectWidth = Math.min(width, rawLeft + size) - left;
  const rectHeight = Math.min(height, rawTop + size) - top;
  const origin = uv(left, top), x = uv(left + 1, top), y = uv(left, top + 1);
  return { id, generations: ['SFC'], texture: 'assets/textures/gen2/metal_grate.png',
    screenRect: [left, top, rectWidth, rectHeight], uvOrigin: origin,
    uvStepX: [x[0] - origin[0], x[1] - origin[1]], uvStepY: [y[0] - origin[0], y[1] - origin[1]], wrap: 'repeat' };
}
