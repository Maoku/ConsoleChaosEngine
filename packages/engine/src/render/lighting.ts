import type { GenerationId } from '../generation/profiles';
import type { LightCommand, Vec3 } from './frame';

export const FALLBACK_LIGHT_DIRECTION: Vec3 = [0.4, 1, 0.6];
export const DEFAULT_MAX_DIRECTIONAL_LIGHTS = 4;
export const DEFAULT_MAX_POINT_LIGHTS = 4;
export const DEFAULT_SHADOW_STRENGTH = 0.72;
export const DEFAULT_SHADOW_MAX_STRETCH = 3;
export const DEFAULT_SHADOW_LIFT = 0.02;
const WHITE: Vec3 = [1, 1, 1];

export interface ResolvedShadowSettings {
  strength: number;
  maxStretch: number;
  lift: number;
}

export interface ResolvedDirectionalLight {
  direction: Vec3;
  color: Vec3;
}

export interface ResolvedPointLight {
  positionRadius: readonly [number, number, number, number];
  color: Vec3;
  shadow: ResolvedShadowSettings | null;
}

export interface ResolvedFrameLighting {
  ambient: Vec3;
  directionalLights: ResolvedDirectionalLight[];
  pointLights: ResolvedPointLight[];
}

export interface FrameLightingLimits {
  directionalLights?: number;
  pointLights?: number;
}

function applies(command: LightCommand, generation: GenerationId): boolean {
  return command.generations === undefined || command.generations.includes(generation);
}

function color(colorValue: string): Vec3 {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(colorValue);
  if (!match) return WHITE;
  return [
    Number.parseInt(match[1]!, 16) / 255,
    Number.parseInt(match[2]!, 16) / 255,
    Number.parseInt(match[3]!, 16) / 255,
  ];
}

function scaledColor(command: LightCommand): Vec3 {
  const base = color(command.color);
  return [base[0] * command.intensity, base[1] * command.intensity, base[2] * command.intensity];
}

function limitOf(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`Light limit must be a positive integer; received ${value}`);
  }
  return value;
}

function finiteAtLeast(value: number, minimum: number, label: string): number {
  if (!Number.isFinite(value) || value < minimum) {
    throw new RangeError(`${label} must be finite and at least ${minimum}; received ${value}`);
  }
  return value;
}

function shadowOf(command: LightCommand): ResolvedShadowSettings | null {
  if (command.shadow === false) return null;
  return {
    strength: Math.min(finiteAtLeast(command.shadow?.strength ?? DEFAULT_SHADOW_STRENGTH, 0, 'shadow.strength'), 1),
    maxStretch: finiteAtLeast(command.shadow?.maxStretch ?? DEFAULT_SHADOW_MAX_STRETCH, 1, 'shadow.maxStretch'),
    lift: finiteAtLeast(command.shadow?.lift ?? DEFAULT_SHADOW_LIFT, 0, 'shadow.lift'),
  };
}

export function resolveFrameLighting(
  commands: readonly LightCommand[],
  generation: GenerationId,
  dynamicLight: boolean,
  fallbackAmbient: Vec3,
  limits: FrameLightingLimits = {},
): ResolvedFrameLighting {
  const visible = commands.filter((command) => applies(command, generation));
  const ambientCommands = visible.filter((command) => command.kind === 'ambient');
  const ambient: [number, number, number] = ambientCommands.length === 0 ? [...fallbackAmbient] : [0, 0, 0];
  for (const command of ambientCommands) {
    const contribution = scaledColor(command);
    for (let axis = 0; axis < 3; axis++) ambient[axis] = ambient[axis]! + contribution[axis]!;
  }

  const directionalLimit = limitOf(limits.directionalLights, DEFAULT_MAX_DIRECTIONAL_LIGHTS);
  const pointLimit = limitOf(limits.pointLights, DEFAULT_MAX_POINT_LIGHTS);
  const directionalLights = visible
    .filter((command) => command.kind === 'directional')
    .sort((left, right) => right.intensity - left.intensity)
    .slice(0, directionalLimit)
    .map((command) => ({
      direction: command.direction ?? FALLBACK_LIGHT_DIRECTION,
      color: scaledColor(command),
    }));
  const pointLights = dynamicLight
    ? visible
      .filter((command) => (command.kind ?? 'point') === 'point')
      .sort((left, right) => right.intensity - left.intensity)
      .slice(0, pointLimit)
      .map((command) => ({
        positionRadius: [command.position[0], command.position[1], command.position[2], command.radius] as const,
        color: scaledColor(command),
        shadow: shadowOf(command),
      }))
    : [];
  if (directionalLights.length === 0) {
    directionalLights.push({ direction: FALLBACK_LIGHT_DIRECTION, color: WHITE });
  }
  return { ambient, directionalLights, pointLights };
}
