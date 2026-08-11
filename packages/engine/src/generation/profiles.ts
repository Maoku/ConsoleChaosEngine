export const GENERATION_IDS = ['FC', 'SFC', 'PS1', 'PS2'] as const;
export type GenerationId = (typeof GENERATION_IDS)[number];
export type ProjectionMode = 'ortho2d' | 'perspective3d';
export type SignalKind = 'rf' | 'composite' | 'svideo' | 'component';
export type PaletteMode = 'fixed54' | 'rgb555' | 'truecolor';
export type DirectionalInput = 'dpad4' | 'dpad8' | 'analog';
export type SynthKind = 'psg' | 'brr' | 'adpcm' | 'streaming';

export interface HardwareGenerationProfile {
  id: GenerationId;
  video: {
    internalWidth: number;
    internalHeight: number;
    projection: ProjectionMode;
    signal: SignalKind;
    paletteMode: PaletteMode;
    maxSimultaneousColors: number;
    paletteBlockSize: number;
    spritesPerScanline: number;
    tileSnap: number;
    alphaBlend: boolean;
    affinePlane: boolean;
    depthBuffer: boolean;
    affineTexture: boolean;
    vertexQuantize: number;
    dynamicLight: boolean;
    textureFilter: 'nearest' | 'linear';
    animationHz: number;
  };
  audio: {
    channels: number;
    synth: SynthKind;
    sampleRate: number;
    reverb: boolean;
    positional: boolean;
  };
  input: {
    directional: DirectionalInput;
    allowDiagonal: boolean;
    analogAxes: 0 | 2 | 4;
    pressureSensitive: boolean;
    rumble: boolean;
  };
}

export const HARDWARE_GENERATION_PROFILES: Record<GenerationId, HardwareGenerationProfile> = {
  FC: {
    id: 'FC',
    video: { internalWidth: 256, internalHeight: 224, projection: 'ortho2d', signal: 'rf', paletteMode: 'fixed54', maxSimultaneousColors: 25, paletteBlockSize: 16, spritesPerScanline: 8, tileSnap: 8, alphaBlend: false, affinePlane: false, depthBuffer: false, affineTexture: false, vertexQuantize: 0, dynamicLight: false, textureFilter: 'nearest', animationHz: 6 },
    audio: { channels: 5, synth: 'psg', sampleRate: 0, reverb: false, positional: false },
    input: { directional: 'dpad4', allowDiagonal: false, analogAxes: 0, pressureSensitive: false, rumble: false },
  },
  SFC: {
    id: 'SFC',
    video: { internalWidth: 256, internalHeight: 224, projection: 'ortho2d', signal: 'composite', paletteMode: 'rgb555', maxSimultaneousColors: 256, paletteBlockSize: 8, spritesPerScanline: 32, tileSnap: 1, alphaBlend: true, affinePlane: true, depthBuffer: false, affineTexture: false, vertexQuantize: 0, dynamicLight: false, textureFilter: 'nearest', animationHz: 12 },
    audio: { channels: 8, synth: 'brr', sampleRate: 32000, reverb: true, positional: false },
    input: { directional: 'dpad8', allowDiagonal: true, analogAxes: 0, pressureSensitive: false, rumble: false },
  },
  PS1: {
    id: 'PS1',
    video: { internalWidth: 320, internalHeight: 240, projection: 'perspective3d', signal: 'svideo', paletteMode: 'truecolor', maxSimultaneousColors: -1, paletteBlockSize: 0, spritesPerScanline: -1, tileSnap: 0, alphaBlend: true, affinePlane: false, depthBuffer: false, affineTexture: true, vertexQuantize: 2, dynamicLight: false, textureFilter: 'nearest', animationHz: 30 },
    audio: { channels: 24, synth: 'adpcm', sampleRate: 44100, reverb: true, positional: true },
    input: { directional: 'analog', allowDiagonal: true, analogAxes: 2, pressureSensitive: false, rumble: true },
  },
  PS2: {
    id: 'PS2',
    video: { internalWidth: 640, internalHeight: 448, projection: 'perspective3d', signal: 'component', paletteMode: 'truecolor', maxSimultaneousColors: -1, paletteBlockSize: 0, spritesPerScanline: -1, tileSnap: 0, alphaBlend: true, affinePlane: false, depthBuffer: true, affineTexture: false, vertexQuantize: 0, dynamicLight: true, textureFilter: 'linear', animationHz: 60 },
    audio: { channels: 48, synth: 'streaming', sampleRate: 48000, reverb: true, positional: true },
    input: { directional: 'analog', allowDiagonal: true, analogAxes: 4, pressureSensitive: true, rumble: true },
  },
};

export type GenerationVariant<Value> = Readonly<Record<GenerationId, Value>>;

export function defineGenerationVariant<Value>(variant: GenerationVariant<Value>): GenerationVariant<Value> {
  return variant;
}

export function generationValue<Value>(variant: GenerationVariant<Value>, generation: GenerationId): Value {
  return variant[generation];
}
