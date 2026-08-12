import type { GenerationId } from '../generation/profiles';

export type PortableBlendOperation = 'alpha' | 'add' | 'subtract' | 'multiply';
export type Gen3SemitransparencyMode = 'average' | 'add' | 'subtract' | 'quarter-add';
export type Gen4GsPreset = 'source-over' | 'fixed-alpha' | 'add' | 'subtract' | 'multiply';

export type HardwareBlendCommand =
  | {
      family: 'portable';
      operation: PortableBlendOperation;
      opacity?: number;
    }
  | {
      family: 'gen2-color-math';
      operation: 'add' | 'subtract';
      half: boolean;
      operand?: 'subscreen' | 'fixed';
      fixedColor?: readonly [number, number, number];
    }
  | {
      family: 'gen3-semitransparency';
      mode: Gen3SemitransparencyMode;
    }
  | {
      family: 'gen4-gs';
      preset: Gen4GsPreset;
      opacity?: number;
    };

export type LegacyBlendMode = 'opaque' | 'alpha' | 'additive';
export type RgbColor = readonly [number, number, number];
export type RgbaColor = readonly [number, number, number, number];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const rgb = (red: number, green: number, blue: number): RgbColor =>
  [clamp01(red), clamp01(green), clamp01(blue)];

export function quantizeRgb(color: RgbColor, bits: number): RgbColor {
  const maximum = (1 << bits) - 1;
  return rgb(
    Math.round(clamp01(color[0]) * maximum) / maximum,
    Math.round(clamp01(color[1]) * maximum) / maximum,
    Math.round(clamp01(color[2]) * maximum) / maximum,
  );
}

export function blendGen2ColorMath(
  source: RgbColor,
  destination: RgbColor,
  command: Extract<HardwareBlendCommand, { family: 'gen2-color-math' }>,
): RgbColor {
  const main = quantizeRgb(destination, 5);
  const usesFixed = command.operand === 'fixed' || command.fixedColor !== undefined;
  if (command.operand === 'fixed' && command.fixedColor === undefined) {
    throw new Error('Gen2 fixed color blending requires fixedColor');
  }
  const operand = quantizeRgb(usesFixed ? (command.fixedColor ?? [0, 0, 0]) : source, 5);
  const sign = command.operation === 'add' ? 1 : -1;
  const scale = command.half ? 0.5 : 1;
  return quantizeRgb(
    rgb(
      (main[0] + operand[0] * sign) * scale,
      (main[1] + operand[1] * sign) * scale,
      (main[2] + operand[2] * sign) * scale,
    ),
    5,
  );
}

export function blendGen3Semitransparency(
  source: RgbColor,
  destination: RgbColor,
  mode: Gen3SemitransparencyMode,
): RgbColor {
  switch (mode) {
    case 'average':
      return rgb(
        destination[0] * 0.5 + source[0] * 0.5,
        destination[1] * 0.5 + source[1] * 0.5,
        destination[2] * 0.5 + source[2] * 0.5,
      );
    case 'add':
      return rgb(destination[0] + source[0], destination[1] + source[1], destination[2] + source[2]);
    case 'subtract':
      return rgb(destination[0] - source[0], destination[1] - source[1], destination[2] - source[2]);
    case 'quarter-add':
      return rgb(
        destination[0] + source[0] * 0.25,
        destination[1] + source[1] * 0.25,
        destination[2] + source[2] * 0.25,
      );
  }
}

function rgba(red: number, green: number, blue: number, alpha: number): RgbaColor {
  return [clamp01(red), clamp01(green), clamp01(blue), clamp01(alpha)];
}

export function blendGen4Gs(
  source: RgbaColor,
  destination: RgbaColor,
  preset: Gen4GsPreset,
  opacity?: number,
): RgbaColor {
  const sourceOpacity = clamp01(source[3] * (opacity ?? 1));
  const fixedOpacity = clamp01(opacity ?? 0.5);
  if (preset === 'source-over' || preset === 'fixed-alpha') {
    const amount = preset === 'source-over' ? sourceOpacity : fixedOpacity;
    return rgba(
      source[0] * amount + destination[0] * (1 - amount),
      source[1] * amount + destination[1] * (1 - amount),
      source[2] * amount + destination[2] * (1 - amount),
      amount + destination[3] * (1 - amount),
    );
  }
  if (preset === 'multiply') {
    return rgba(
      destination[0] * (1 - sourceOpacity + source[0] * sourceOpacity),
      destination[1] * (1 - sourceOpacity + source[1] * sourceOpacity),
      destination[2] * (1 - sourceOpacity + source[2] * sourceOpacity),
      Math.max(destination[3], sourceOpacity),
    );
  }
  const sign = preset === 'add' ? 1 : -1;
  return rgba(
    destination[0] + source[0] * sourceOpacity * sign,
    destination[1] + source[1] * sourceOpacity * sign,
    destination[2] + source[2] * sourceOpacity * sign,
    Math.max(destination[3], sourceOpacity),
  );
}

export function blendModeToHardwareBlend(blendMode?: LegacyBlendMode): HardwareBlendCommand | undefined {
  if (blendMode === 'alpha') return { family: 'portable', operation: 'alpha' };
  if (blendMode === 'additive') return { family: 'portable', operation: 'add' };
  return undefined;
}

export function hardwareBlendForCommand(
  hardwareBlend?: HardwareBlendCommand,
  blendMode?: LegacyBlendMode,
): HardwareBlendCommand | undefined {
  return hardwareBlend ?? blendModeToHardwareBlend(blendMode);
}

export function hardwareBlendGeneration(command: HardwareBlendCommand): GenerationId | undefined {
  if (command.family === 'gen2-color-math') return 'SFC';
  if (command.family === 'gen3-semitransparency') return 'PS1';
  if (command.family === 'gen4-gs') return 'PS2';
  return undefined;
}

export function assertHardwareBlendGenerations(
  generations: readonly GenerationId[] | undefined,
  command: HardwareBlendCommand | undefined,
): void {
  if (!command || !generations) return;
  const required = hardwareBlendGeneration(command);
  if (!required) return;
  const incompatible = generations.find((generation) => generation !== required);
  if (incompatible) {
    throw new Error(`${command.family} cannot be used for generation ${incompatible}; expected ${required}`);
  }
}

export function generationSupportsHardwareBlend(
  generation: GenerationId,
  command: HardwareBlendCommand | undefined,
): boolean {
  if (!command) return true;
  if (generation === 'FC') return false;
  const required = hardwareBlendGeneration(command);
  return required === undefined || required === generation;
}
