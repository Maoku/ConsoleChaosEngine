import type { Vec3 } from './projection';
export const TORCH_RADIUS = 7;
export function torchPosition(player: Vec3): Vec3 {
  return [player[0], player[1] + 0.6, player[2]];
}
/** Same spherical falloff as the point-light shader; the demo does not simulate occlusion. */
export function torchExposure(player: Vec3, point: Vec3): number {
  const position = torchPosition(player);
  const distance = Math.hypot(...point.map((value, axis) => value - position[axis]!));
  return Math.max(0, 1 - distance / TORCH_RADIUS) ** 2;
}
