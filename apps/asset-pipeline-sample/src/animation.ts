import {
  defineGenerationVariant,
  type GenerationVariant,
  type HardwareGenerationProfile,
} from '@console-chaos/engine';

const AMPLITUDE_RADIANS = 5 * Math.PI / 180;

export interface SwayAnimationProfile {
  readonly mode: 'step' | 'tween';
  readonly sampleHz: number;
  readonly amplitudeRadians: number;
  readonly cycleSeconds: number;
  readonly stepPattern?: readonly number[];
}

export const SWAY_ANIMATION_PROFILES: GenerationVariant<SwayAnimationProfile> = defineGenerationVariant({
  FC: {
    mode: 'step',
    sampleHz: 4,
    amplitudeRadians: AMPLITUDE_RADIANS,
    cycleSeconds: 1,
    stepPattern: [-1, 0, 1, 0],
  },
  SFC: {
    mode: 'step',
    sampleHz: 8,
    amplitudeRadians: AMPLITUDE_RADIANS,
    cycleSeconds: 1,
    stepPattern: [-1, -1, 0, 0, 1, 1, 0, 0],
  },
  PS1: {
    mode: 'tween',
    sampleHz: 30,
    amplitudeRadians: AMPLITUDE_RADIANS,
    cycleSeconds: 1,
  },
  PS2: {
    mode: 'tween',
    sampleHz: 60,
    amplitudeRadians: AMPLITUDE_RADIANS,
    cycleSeconds: 1,
  },
});

const positiveModulo = (value: number, divisor: number): number =>
  ((value % divisor) + divisor) % divisor;

const smoothstep = (value: number): number => value * value * (3 - 2 * value);

export function swayAngle(
  hardware: HardwareGenerationProfile,
  timeSeconds: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return 0;
  const profile = SWAY_ANIMATION_PROFILES[hardware.id];
  const sample = Math.floor(Math.max(timeSeconds, 0) * profile.sampleHz + 1e-9);
  if (profile.mode === 'step') {
    const pattern = profile.stepPattern;
    if (!pattern || pattern.length === 0) throw new Error(`${hardware.id} step pattern is empty`);
    return (pattern[sample % pattern.length] ?? 0) * profile.amplitudeRadians;
  }

  const sampledTime = sample / profile.sampleHz;
  const phase = positiveModulo(sampledTime, profile.cycleSeconds) / profile.cycleSeconds;
  const halfPhase = phase < 0.5 ? phase * 2 : (phase - 0.5) * 2;
  const eased = smoothstep(halfPhase);
  const normalized = phase < 0.5 ? -1 + 2 * eased : 1 - 2 * eased;
  return normalized * profile.amplitudeRadians;
}

export function pivotedSpriteCenter(
  pivot: readonly [number, number],
  size: readonly [number, number],
  angle: number,
): readonly [number, number] {
  const halfHeight = size[1] / 2;
  return [
    pivot[0] + Math.sin(angle) * halfHeight,
    pivot[1] - Math.cos(angle) * halfHeight,
  ];
}
