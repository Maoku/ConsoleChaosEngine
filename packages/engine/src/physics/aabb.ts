import type { Vec3 } from '../render/frame';

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export function aabbFromCenter(center: Vec3, halfExtents: Vec3): Aabb {
  return {
    min: [center[0] - halfExtents[0], center[1] - halfExtents[1], center[2] - halfExtents[2]],
    max: [center[0] + halfExtents[0], center[1] + halfExtents[1], center[2] + halfExtents[2]],
  };
}

export function overlaps(left: Aabb, right: Aabb): boolean {
  return left.min[0] <= right.max[0] && left.max[0] >= right.min[0]
    && left.min[1] <= right.max[1] && left.max[1] >= right.min[1]
    && left.min[2] <= right.max[2] && left.max[2] >= right.min[2];
}

export interface SweepHit {
  time: number;
  normal: Vec3;
}

export function sweepAabb(moving: Aabb, velocity: Vec3, target: Aabb): SweepHit | null {
  let entryTime = -Infinity;
  let exitTime = Infinity;
  let normal: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const speed = velocity[axis] ?? 0;
    const movingMin = moving.min[axis] ?? 0;
    const movingMax = moving.max[axis] ?? 0;
    const targetMin = target.min[axis] ?? 0;
    const targetMax = target.max[axis] ?? 0;
    if (speed === 0) {
      if (movingMax < targetMin || movingMin > targetMax) return null;
      continue;
    }
    const near = ((speed > 0 ? targetMin - movingMax : targetMax - movingMin) / speed);
    const far = ((speed > 0 ? targetMax - movingMin : targetMin - movingMax) / speed);
    if (near > entryTime) {
      entryTime = near;
      const components: [number, number, number] = [0, 0, 0];
      components[axis] = speed > 0 ? -1 : 1;
      normal = components;
    }
    exitTime = Math.min(exitTime, far);
  }
  return entryTime <= exitTime && entryTime >= 0 && entryTime <= 1 ? { time: entryTime, normal } : null;
}

export function nearestPointOnSegment(point: Vec3, start: Vec3, end: Vec3): Vec3 {
  const segment: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const lengthSquared = segment[0] ** 2 + segment[1] ** 2 + segment[2] ** 2;
  if (lengthSquared === 0) return start;
  const amount = Math.min(Math.max(((point[0] - start[0]) * segment[0] + (point[1] - start[1]) * segment[1] + (point[2] - start[2]) * segment[2]) / lengthSquared, 0), 1);
  return [start[0] + segment[0] * amount, start[1] + segment[1] * amount, start[2] + segment[2] * amount];
}
