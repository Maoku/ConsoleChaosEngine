import {
  defineGenerationVariant,
  type GenerationVariant,
  type HardwareGenerationProfile,
} from '@console-chaos/engine';

const AMPLITUDE_RADIANS = 5 * Math.PI / 180;
const BLINK_CYCLE_SECONDS = 3;

export const CHARACTER_POSES = ['left', 'center', 'right'] as const;
export type CharacterPose = (typeof CHARACTER_POSES)[number];
export const EYE_FRAMES = ['open', 'half', 'closed'] as const;
export type EyeFrame = (typeof EYE_FRAMES)[number];

export interface SwayAnimationProfile {
  readonly mode: 'step' | 'tween';
  readonly sampleHz: number;
  readonly amplitudeRadians: number;
  readonly cycleSeconds: number;
  readonly posePattern?: readonly CharacterPose[];
  readonly blinkPattern: readonly EyeFrame[];
}

export interface TitleAnimationFrame {
  readonly angle: number;
  readonly pose: CharacterPose;
  readonly eyes: EyeFrame;
}

export const SWAY_ANIMATION_PROFILES: GenerationVariant<SwayAnimationProfile> = defineGenerationVariant({
  FC: {
    mode: 'step',
    sampleHz: 6,
    amplitudeRadians: AMPLITUDE_RADIANS,
    cycleSeconds: 1,
    posePattern: ['left', 'left', 'center', 'right', 'right', 'center'],
    blinkPattern: ['closed'],
  },
  SFC: {
    mode: 'step',
    sampleHz: 12,
    amplitudeRadians: AMPLITUDE_RADIANS,
    cycleSeconds: 1,
    posePattern: [
      'left', 'left', 'left', 'left',
      'center', 'center',
      'right', 'right', 'right', 'right',
      'center', 'center',
    ],
    blinkPattern: ['half', 'closed', 'half'],
  },
  PS1: {
    mode: 'tween',
    sampleHz: 30,
    amplitudeRadians: AMPLITUDE_RADIANS,
    cycleSeconds: 1,
    blinkPattern: ['half', 'closed', 'closed', 'closed', 'half'],
  },
  PS2: {
    mode: 'tween',
    sampleHz: 60,
    amplitudeRadians: AMPLITUDE_RADIANS,
    cycleSeconds: 1,
    blinkPattern: ['half', 'half', 'closed', 'closed', 'closed', 'closed', 'closed', 'half', 'half'],
  },
});

const positiveModulo = (value: number, divisor: number): number =>
  ((value % divisor) + divisor) % divisor;

const smoothstep = (value: number): number => value * value * (3 - 2 * value);

function tweenNormalized(profile: SwayAnimationProfile, sample: number): number {
  const sampledTime = sample / profile.sampleHz;
  const phase = positiveModulo(sampledTime, profile.cycleSeconds) / profile.cycleSeconds;
  const halfPhase = phase < 0.5 ? phase * 2 : (phase - 0.5) * 2;
  const eased = smoothstep(halfPhase);
  return phase < 0.5 ? -1 + 2 * eased : 1 - 2 * eased;
}

function poseForTween(profile: SwayAnimationProfile, sample: number): CharacterPose {
  // Texture animation follows one hardware sample behind the continuous body Tween.
  const delayed = Math.max(sample - 1, 0);
  const normalized = tweenNormalized(profile, delayed);
  if (normalized < -1 / 3) return 'left';
  if (normalized > 1 / 3) return 'right';
  return 'center';
}

function blinkFrame(profile: SwayAnimationProfile, sample: number): EyeFrame {
  const cycleSamples = Math.round(BLINK_CYCLE_SECONDS * profile.sampleHz);
  const cycleSample = positiveModulo(sample, cycleSamples);
  const blinkStart = cycleSamples - profile.blinkPattern.length;
  if (cycleSample < blinkStart) return 'open';
  return profile.blinkPattern[cycleSample - blinkStart] ?? 'open';
}

export function titleAnimationFrame(
  hardware: HardwareGenerationProfile,
  timeSeconds: number,
  reducedMotion: boolean,
): TitleAnimationFrame {
  const profile = SWAY_ANIMATION_PROFILES[hardware.id];
  const sample = Math.floor(Math.max(timeSeconds, 0) * profile.sampleHz + 1e-9);
  const eyes = blinkFrame(profile, sample);
  if (reducedMotion) return { angle: 0, pose: 'center', eyes };

  if (profile.mode === 'step') {
    const pattern = profile.posePattern;
    if (!pattern || pattern.length === 0) throw new Error(`${hardware.id} pose pattern is empty`);
    return {
      angle: 0,
      pose: pattern[sample % pattern.length] ?? 'center',
      eyes,
    };
  }

  return {
    angle: tweenNormalized(profile, sample) * profile.amplitudeRadians,
    pose: poseForTween(profile, sample),
    eyes,
  };
}

export function swayAngle(
  hardware: HardwareGenerationProfile,
  timeSeconds: number,
  reducedMotion: boolean,
): number {
  return titleAnimationFrame(hardware, timeSeconds, reducedMotion).angle;
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
