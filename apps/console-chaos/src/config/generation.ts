import {
  HARDWARE_GENERATION_PROFILES,
  defineGenerationVariant,
  type GenerationId,
  type GenerationVariant,
  type HardwareGenerationProfile,
} from '@console-chaos/engine';
import { KEY_COLORS, fcColorOf, type Rgb } from '@/render/key_palette';

export type ForwardXZ = readonly [number, number];

export interface ConsoleCameraTheme {
  forward: ForwardXZ;
  distance: number;
  height: number;
  targetHeight: number;
  lookAhead: number;
}

export interface ConsoleActionTheme {
  moveSnap: number;
  moveSpeed: number;
  variableJump: boolean;
  wallJump: boolean;
  attack: 'forward' | 'forward_charge' | 'omni' | 'omni_lock';
  fineControl: boolean;
}

export type PlayerClip = 'idle' | 'walk' | 'jump';

export interface PlayerClipRef {
  animation: string;
  freeze: boolean;
}

export interface PlayerModelProfile {
  kind: 'model';
  file: string;
  front: '-Z' | '+Z';
  clips: Record<PlayerClip, PlayerClipRef>;
}

export interface PlayerSpriteClip {
  first: number;
  frames: number;
  frameSeconds: number;
  loop: boolean;
}

export interface PlayerSpriteProfile {
  kind: 'sprite';
  file: string;
  cell: number;
  columns: number;
  rows: number;
  worldSize: number;
  clips: Record<PlayerClip, PlayerSpriteClip>;
}

export type PlayerVisual = PlayerModelProfile | PlayerSpriteProfile;

export interface BackdropLayer {
  texture: string;
  repeat: number;
  scroll: number;
  scrollY: number;
  bottom: number;
  height: number;
}

export interface BackdropProfile {
  sky: readonly [Rgb, Rgb];
  far: BackdropLayer | null;
  near: BackdropLayer | null;
}

export interface ConsoleArtTheme {
  textureSet: string;
  backdrop: BackdropProfile;
  fogDensity: number;
}

export type ConsoleActionName = 'jump' | 'action' | 'subAction';

export interface ConsoleChaosGenerationTheme {
  display: { channel: string; label: string };
  camera: ConsoleCameraTheme;
  action: ConsoleActionTheme;
  player: PlayerVisual;
  art: ConsoleArtTheme;
  availableActions: readonly ConsoleActionName[];
}

export interface ConsoleChaosGenerationView {
  hardware: HardwareGenerationProfile;
  theme: ConsoleChaosGenerationTheme;
}

const SIDE_ON_2D_CAMERA: ConsoleCameraTheme = {
  forward: [0, -1],
  distance: 14,
  height: 0,
  targetHeight: 0,
  lookAhead: 0,
};

function heroSprite(file: string): PlayerSpriteProfile {
  return {
    kind: 'sprite',
    file,
    cell: 64,
    columns: 4,
    rows: 4,
    worldSize: 2,
    clips: {
      idle: { first: 12, frames: 1, frameSeconds: 0.14, loop: false },
      walk: { first: 0, frames: 6, frameSeconds: 0.11, loop: true },
      jump: { first: 6, frames: 6, frameSeconds: 0.115, loop: false },
    },
  };
}

function rgb555([r, g, b]: Rgb): Rgb {
  return [r & 0xf8, g & 0xf8, b & 0xf8];
}

/** Console 固有の唯一の世代 theme 正本。hardware 値は一切含めない。 */
export const CONSOLE_CHAOS_GENERATION_THEMES: GenerationVariant<ConsoleChaosGenerationTheme> =
  defineGenerationVariant({
    FC: {
      display: { channel: 'CH 1', label: '第1世代' },
      camera: SIDE_ON_2D_CAMERA,
      availableActions: ['jump', 'action'],
      action: {
        moveSnap: 0.25,
        moveSpeed: 4.5,
        variableJump: false,
        wallJump: false,
        attack: 'forward',
        fineControl: false,
      },
      player: heroSprite('hero_gen1.png'),
      art: {
        textureSet: 'gen1',
        backdrop: {
          sky: [fcColorOf('skyDay').source, fcColorOf('skyDay').source],
          far: {
            texture: 'backdrop_far.png',
            repeat: 1,
            scroll: 0.125,
            scrollY: 0.143,
            bottom: 0.5,
            height: 0.5714,
          },
          near: null,
        },
        fogDensity: 0,
      },
    },
    SFC: {
      display: { channel: 'CH 2', label: '第2世代' },
      camera: SIDE_ON_2D_CAMERA,
      availableActions: ['jump', 'action', 'subAction'],
      action: {
        moveSnap: 0,
        moveSpeed: 5,
        variableJump: false,
        wallJump: true,
        attack: 'forward_charge',
        fineControl: false,
      },
      player: heroSprite('hero_gen2.png'),
      art: {
        textureSet: 'gen2',
        backdrop: {
          sky: [rgb555(KEY_COLORS.skyDay), rgb555(KEY_COLORS.skyHorizon)],
          far: {
            texture: 'backdrop_far.png',
            repeat: 1,
            scroll: 0.00625,
            scrollY: 0.007,
            bottom: 0.24,
            height: 0.34,
          },
          near: {
            texture: 'backdrop_near.png',
            repeat: 1,
            scroll: 0.05625,
            scrollY: 0.064,
            bottom: 0.5,
            height: 0.42,
          },
        },
        fogDensity: 0,
      },
    },
    PS1: {
      display: { channel: 'CH 3', label: '第3世代' },
      camera: { forward: [0, -1], distance: 3, height: 1.0667, targetHeight: 0.3, lookAhead: 0.8 },
      availableActions: ['jump', 'action', 'subAction'],
      action: {
        moveSnap: 0,
        moveSpeed: 5.5,
        variableJump: true,
        wallJump: true,
        attack: 'omni',
        fineControl: true,
      },
      player: {
        kind: 'model',
        file: 'gen3_character.glb',
        front: '+Z',
        clips: {
          idle: { animation: 'Idle_4', freeze: false },
          walk: { animation: 'Walking', freeze: false },
          jump: { animation: '360_Power_Spin_Jump', freeze: false },
        },
      },
      art: {
        textureSet: 'gen3',
        backdrop: {
          sky: [KEY_COLORS.mesaFar, KEY_COLORS.mesaFar],
          far: {
            texture: 'backdrop_far.png',
            repeat: 0.75,
            scroll: 0.003,
            scrollY: 0,
            bottom: 0.26,
            height: 0.3,
          },
          near: null,
        },
        fogDensity: 0.035,
      },
    },
    PS2: {
      display: { channel: 'CH 4', label: '第4世代' },
      camera: { forward: [1, 0], distance: 4, height: 1, targetHeight: 0.6, lookAhead: 5 },
      availableActions: ['jump', 'action', 'subAction'],
      action: {
        moveSnap: 0,
        moveSpeed: 5.5,
        variableJump: true,
        wallJump: true,
        attack: 'omni_lock',
        fineControl: true,
      },
      player: {
        kind: 'model',
        file: 'gen4_character.glb',
        front: '+Z',
        clips: {
          idle: { animation: 'Walking', freeze: true },
          walk: { animation: 'Walking', freeze: false },
          jump: { animation: '360_Power_Spin_Jump', freeze: false },
        },
      },
      art: {
        textureSet: 'gen4',
        backdrop: {
          sky: [KEY_COLORS.skyDay, KEY_COLORS.skyHorizon],
          far: {
            texture: 'backdrop_far.png',
            repeat: 1.25,
            scroll: 0.004,
            scrollY: 0,
            bottom: 0.14,
            height: 0.44,
          },
          near: null,
        },
        fogDensity: 0,
      },
    },
  });

export function generationView(id: GenerationId): ConsoleChaosGenerationView {
  return {
    hardware: HARDWARE_GENERATION_PROFILES[id],
    theme: CONSOLE_CHAOS_GENERATION_THEMES[id],
  };
}

export const DISPLAY_NAMES: Readonly<Record<GenerationId, { channel: string; label: string }>> =
  Object.fromEntries(
    Object.entries(CONSOLE_CHAOS_GENERATION_THEMES).map(([id, theme]) => [id, theme.display]),
  ) as Record<GenerationId, { channel: string; label: string }>;
