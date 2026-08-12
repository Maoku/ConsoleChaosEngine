import type { GenerationId } from '../generation/profiles';
import { createBlendState, type BlendState } from './gl/state';

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

export interface ResolvedHardwareBlend {
  visible: boolean;
  translucent: boolean;
  readonly state: BlendState;
  readonly colorOverride: [number, number, number, number];
  premultiplyColor: boolean;
  outputOpacity: number;
}

export function createResolvedHardwareBlend(): ResolvedHardwareBlend {
  return {
    visible: true,
    translucent: false,
    state: createBlendState(),
    colorOverride: [0, 0, 0, 0],
    premultiplyColor: false,
    outputOpacity: 1,
  };
}

function resetResolved(out: ResolvedHardwareBlend): void {
  out.visible = true;
  out.translucent = false;
  out.premultiplyColor = false;
  out.outputOpacity = 1;
  out.colorOverride[0] = 0;
  out.colorOverride[1] = 0;
  out.colorOverride[2] = 0;
  out.colorOverride[3] = 0;
  const state = out.state;
  state.enabled = false;
  state.equationRgb = 'add';
  state.equationAlpha = 'add';
  state.sourceRgb = 'one';
  state.destinationRgb = 'zero';
  state.sourceAlpha = 'one';
  state.destinationAlpha = 'zero';
  const constant = state.constantColor as [number, number, number, number];
  constant[0] = 0;
  constant[1] = 0;
  constant[2] = 0;
  constant[3] = 0;
}

function enableBlend(out: ResolvedHardwareBlend): BlendState {
  out.translucent = true;
  out.state.enabled = true;
  out.state.destinationAlpha = 'one-minus-source-alpha';
  return out.state;
}

function setConstant(out: ResolvedHardwareBlend, color: readonly [number, number, number, number]): void {
  const constant = out.state.constantColor as [number, number, number, number];
  for (let index = 0; index < 4; index++) constant[index] = clamp01(color[index] ?? 0);
}

function resolvePortable(
  generation: GenerationId,
  command: Extract<HardwareBlendCommand, { family: 'portable' }>,
  out: ResolvedHardwareBlend,
): void {
  const state = enableBlend(out);
  const opacity = clamp01(command.opacity ?? 1);
  out.outputOpacity = opacity;
  if (command.operation === 'multiply') {
    out.premultiplyColor = true;
    state.sourceRgb = 'destination-color';
    state.destinationRgb = 'one-minus-source-alpha';
    return;
  }
  if (command.operation === 'subtract') {
    state.equationRgb = 'reverse-subtract';
    state.sourceRgb = 'source-alpha';
    state.destinationRgb = 'one';
    return;
  }
  if (command.operation === 'add') {
    state.sourceRgb = 'source-alpha';
    state.destinationRgb = 'one';
    return;
  }
  if (generation === 'SFC') {
    setConstant(out, [0, 0, 0, 0.5]);
    state.sourceRgb = 'constant-alpha';
    state.destinationRgb = 'constant-alpha';
  } else if (generation === 'PS1') {
    setConstant(out, [0, 0, 0, 0.5]);
    state.sourceRgb = 'constant-alpha';
    state.destinationRgb = 'constant-alpha';
  } else {
    state.sourceRgb = 'source-alpha';
    state.destinationRgb = 'one-minus-source-alpha';
  }
}

export function resolveHardwareBlend(
  generation: GenerationId,
  hardwareBlend?: HardwareBlendCommand,
  blendMode?: LegacyBlendMode,
  out: ResolvedHardwareBlend = createResolvedHardwareBlend(),
): ResolvedHardwareBlend {
  resetResolved(out);
  const command = hardwareBlendForCommand(hardwareBlend, blendMode);
  if (!command) return out;
  if (!generationSupportsHardwareBlend(generation, command)) {
    out.visible = false;
    return out;
  }
  if (command.family === 'portable') {
    resolvePortable(generation, command, out);
    return out;
  }

  const state = enableBlend(out);
  if (command.family === 'gen2-color-math') {
    const amount = command.half ? 0.5 : 1;
    setConstant(out, [
      command.fixedColor?.[0] ?? 0,
      command.fixedColor?.[1] ?? 0,
      command.fixedColor?.[2] ?? 0,
      amount,
    ]);
    state.equationRgb = command.operation === 'subtract' ? 'reverse-subtract' : 'add';
    state.sourceRgb = command.half ? 'constant-alpha' : 'one';
    state.destinationRgb = command.half ? 'constant-alpha' : 'one';
    if (command.operand === 'fixed' || command.fixedColor !== undefined) {
      if (!command.fixedColor) throw new Error('Gen2 fixed color blending requires fixedColor');
      out.colorOverride[0] = clamp01(command.fixedColor[0]);
      out.colorOverride[1] = clamp01(command.fixedColor[1]);
      out.colorOverride[2] = clamp01(command.fixedColor[2]);
      out.colorOverride[3] = 1;
    }
    return out;
  }
  if (command.family === 'gen3-semitransparency') {
    if (command.mode === 'average' || command.mode === 'quarter-add') {
      const amount = command.mode === 'average' ? 0.5 : 0.25;
      setConstant(out, [0, 0, 0, amount]);
      state.sourceRgb = 'constant-alpha';
      state.destinationRgb = command.mode === 'average' ? 'constant-alpha' : 'one';
    } else {
      state.sourceRgb = 'one';
      state.destinationRgb = 'one';
      if (command.mode === 'subtract') state.equationRgb = 'reverse-subtract';
    }
    return out;
  }

  const opacity = clamp01(command.opacity ?? (command.preset === 'fixed-alpha' ? 0.5 : 1));
  if (command.preset === 'source-over') {
    out.outputOpacity = opacity;
    state.sourceRgb = 'source-alpha';
    state.destinationRgb = 'one-minus-source-alpha';
  } else if (command.preset === 'fixed-alpha') {
    setConstant(out, [0, 0, 0, opacity]);
    state.sourceRgb = 'constant-alpha';
    state.destinationRgb = 'one-minus-constant-alpha';
  } else if (command.preset === 'multiply') {
    out.outputOpacity = opacity;
    out.premultiplyColor = true;
    state.sourceRgb = 'destination-color';
    state.destinationRgb = 'one-minus-source-alpha';
  } else {
    out.outputOpacity = opacity;
    state.sourceRgb = 'source-alpha';
    state.destinationRgb = 'one';
    if (command.preset === 'subtract') state.equationRgb = 'reverse-subtract';
  }
  return out;
}

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
