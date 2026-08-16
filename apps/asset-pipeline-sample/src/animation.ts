import {
  defineGenerationVariant,
  type GenerationVariant,
  type HardwareGenerationProfile,
} from '@console-chaos/engine';

const BLINK_CYCLE_SECONDS = 3;

export const CHARACTER_POSES = ['left', 'center', 'right'] as const;
export type CharacterPose = (typeof CHARACTER_POSES)[number];
export const EYE_FRAMES = ['open', 'half', 'closed'] as const;
export type EyeFrame = (typeof EYE_FRAMES)[number];

export interface SwayAnimationProfile {
  readonly mode: 'step' | 'tween';
  readonly sampleHz: number;
  readonly cycleSeconds: number;
  readonly posePattern?: readonly CharacterPose[];
  readonly blinkPattern: readonly EyeFrame[];
}

export interface PoseTween {
  readonly from: CharacterPose;
  readonly to: CharacterPose;
  readonly progress: number;
}

export interface TitleAnimationFrame {
  /** Nearest authored key pose, useful for state display and diagnostics. */
  readonly pose: CharacterPose;
  /** PS1 texture pair; step generations keep from/to identical. No runtime rotation is used. */
  readonly tween: PoseTween;
  readonly eyes: EyeFrame;
}

export const SWAY_ANIMATION_PROFILES: GenerationVariant<SwayAnimationProfile> = defineGenerationVariant({
  FC: {
    mode: 'step',
    sampleHz: 6,
    cycleSeconds: 1,
    posePattern: ['left', 'left', 'center', 'right', 'right', 'center'],
    blinkPattern: ['closed'],
  },
  SFC: {
    mode: 'step',
    sampleHz: 12,
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
    cycleSeconds: 1,
    blinkPattern: ['half', 'closed', 'closed', 'closed', 'half'],
  },
  PS2: {
    mode: 'step',
    sampleHz: 60,
    cycleSeconds: 1,
    posePattern: [
      ...Array.from({ length: 15 }, () => 'left' as const),
      ...Array.from({ length: 15 }, () => 'center' as const),
      ...Array.from({ length: 15 }, () => 'right' as const),
      ...Array.from({ length: 15 }, () => 'center' as const),
    ],
    blinkPattern: ['half', 'half', 'closed', 'closed', 'closed', 'closed', 'closed', 'half', 'half'],
  },
});

const positiveModulo = (value: number, divisor: number): number =>
  ((value % divisor) + divisor) % divisor;

const smoothstep = (value: number): number => value * value * (3 - 2 * value);

function tweenPose(profile: SwayAnimationProfile, sample: number): PoseTween {
  const sampledTime = sample / profile.sampleHz;
  const phase = positiveModulo(sampledTime, profile.cycleSeconds) / profile.cycleSeconds;
  const path = ['left', 'center', 'right', 'center', 'left'] as const;
  const scaled = phase * (path.length - 1);
  const segment = Math.min(Math.floor(scaled), path.length - 2);
  return {
    from: path[segment] ?? 'left',
    to: path[segment + 1] ?? 'center',
    progress: smoothstep(scaled - segment),
  };
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
  if (reducedMotion) {
    return {
      pose: 'center',
      tween: { from: 'center', to: 'center', progress: 0 },
      eyes,
    };
  }

  if (profile.mode === 'step') {
    const pattern = profile.posePattern;
    if (!pattern || pattern.length === 0) throw new Error(`${hardware.id} pose pattern is empty`);
    const pose = pattern[sample % pattern.length] ?? 'center';
    return {
      pose,
      tween: { from: pose, to: pose, progress: 0 },
      eyes,
    };
  }

  const tween = tweenPose(profile, sample);
  return {
    pose: tween.progress < 0.5 ? tween.from : tween.to,
    tween,
    eyes,
  };
}
