import type { GenerationId } from '../generation/profiles';
import type { LightCommand, Vec3 } from './frame';

export const FALLBACK_LIGHT_DIRECTION: Vec3 = [0.4, 1, 0.6];
const WHITE: Vec3 = [1, 1, 1];

export interface ResolvedFrameLighting {
  ambient: Vec3;
  directionalDirection: Vec3;
  directionalColor: Vec3;
  point: readonly [number, number, number, number];
  pointColor: Vec3;
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

export function resolveFrameLighting(
  commands: readonly LightCommand[],
  generation: GenerationId,
  dynamicLight: boolean,
  fallbackAmbient: Vec3,
): ResolvedFrameLighting {
  const visible = commands.filter((command) => applies(command, generation));
  const ambientCommand = visible.find((command) => command.kind === 'ambient');
  const directional = visible.find((command) => command.kind === 'directional');
  const point = dynamicLight
    ? visible
      .filter((command) => (command.kind ?? 'point') === 'point')
      .sort((left, right) => right.intensity - left.intensity)[0]
    : undefined;
  return {
    ambient: ambientCommand ? scaledColor(ambientCommand) : fallbackAmbient,
    directionalDirection: directional?.direction ?? FALLBACK_LIGHT_DIRECTION,
    directionalColor: directional ? scaledColor(directional) : WHITE,
    point: point ? [point.position[0], point.position[1], point.position[2], point.radius] : [0, 0, 0, 0],
    pointColor: point ? scaledColor(point) : WHITE,
  };
}
