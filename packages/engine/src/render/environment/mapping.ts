import type { Vec2, Vec3 } from '../frame';

const TAU = Math.PI * 2;

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length <= Number.EPSILON) return [0, 0, 1];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function reflectDirection(incident: Vec3, normal: Vec3): Vec3 {
  const unitIncident = normalize(incident);
  const unitNormal = normalize(normal);
  const dot = unitIncident[0] * unitNormal[0]
    + unitIncident[1] * unitNormal[1]
    + unitIncident[2] * unitNormal[2];
  return normalize([
    unitIncident[0] - 2 * dot * unitNormal[0],
    unitIncident[1] - 2 * dot * unitNormal[1],
    unitIncident[2] - 2 * dot * unitNormal[2],
  ]);
}

/** Maps a world-space direction to an equirectangular texture coordinate. */
export function equirectangularUv(direction: Vec3): Vec2 {
  const unit = normalize(direction);
  const rawU = 0.5 + Math.atan2(unit[2], unit[0]) / TAU;
  const u = rawU - Math.floor(rawU);
  const v = Math.acos(Math.min(Math.max(unit[1], -1), 1)) / Math.PI;
  return [u, v];
}

export function reflectionUv(worldPosition: Vec3, worldNormal: Vec3, cameraPosition: Vec3): Vec2 {
  const incident: Vec3 = [
    worldPosition[0] - cameraPosition[0],
    worldPosition[1] - cameraPosition[1],
    worldPosition[2] - cameraPosition[2],
  ];
  return equirectangularUv(reflectDirection(incident, worldNormal));
}
