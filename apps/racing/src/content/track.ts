import { nearestPointOnSegment, type Vec2, type Vec3 } from '@console-chaos/engine';

export interface TrackSample {
  point: Vec2;
  tangent: Vec2;
  progress: number;
  distance: number;
}

export interface RaceTrack {
  readonly points: readonly Vec2[];
  readonly halfWidth: number;
  readonly checkpoints: readonly Vec2[];
  readonly start: Vec2;
  readonly startHeading: number;
}

export const CIRCUIT: RaceTrack = {
  points: [
    [-24, -4], [-20, -15], [-8, -22], [8, -22], [21, -14], [26, -2],
    [22, 12], [11, 20], [-5, 22], [-18, 16], [-26, 6],
  ],
  halfWidth: 4.2,
  checkpoints: [[-24, -4], [8, -22], [26, -2], [-5, 22]],
  start: [-24, -4],
  startHeading: -1.22,
};

const toVec3 = (point: Vec2): Vec3 => [point[0], 0, point[1]];

export function sampleTrack(track: RaceTrack, position: Vec2): TrackSample {
  let bestDistance = Infinity;
  let bestPoint: Vec2 = track.points[0] ?? [0, 0];
  let bestTangent: Vec2 = [1, 0];
  let bestProgress = 0;
  const segmentLengths = track.points.map((point, index) => {
    const next = track.points[(index + 1) % track.points.length] ?? point;
    return Math.hypot(next[0] - point[0], next[1] - point[1]);
  });
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  let lengthBefore = 0;

  track.points.forEach((start, index) => {
    const end = track.points[(index + 1) % track.points.length] ?? start;
    const nearest = nearestPointOnSegment(toVec3(position), toVec3(start), toVec3(end));
    const point: Vec2 = [nearest[0], nearest[2]];
    const distance = Math.hypot(position[0] - point[0], position[1] - point[1]);
    const segmentLength = segmentLengths[index] ?? 0;
    if (distance < bestDistance) {
      const along = segmentLength === 0 ? 0 : Math.hypot(point[0] - start[0], point[1] - start[1]) / segmentLength;
      bestDistance = distance;
      bestPoint = point;
      bestTangent = segmentLength === 0 ? [1, 0] : [(end[0] - start[0]) / segmentLength, (end[1] - start[1]) / segmentLength];
      bestProgress = totalLength === 0 ? 0 : (lengthBefore + segmentLength * along) / totalLength;
    }
    lengthBefore += segmentLength;
  });

  return { point: bestPoint, tangent: bestTangent, progress: bestProgress, distance: bestDistance };
}
