import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  defineGenerationVariant,
  type GameModule,
  type GenerationVariant,
  type RenderFrame,
  type SpriteCommand,
} from '@console-chaos/engine';
import { createTitleActionMap } from './actions';
import {
  titleAnimationFrame,
  type CharacterPose,
  type EyeFrame,
} from './animation';
import { arrangeTitleScore } from './audio';
import {
  TITLE_GENERATION_ASSETS,
  characterFrameKey,
  eyePatchLayout,
} from './render-manifest';

export interface TitleAssetSize {
  readonly logo: readonly [number, number];
  readonly character: readonly [number, number];
}

export const TITLE_ASSET_SIZES: GenerationVariant<TitleAssetSize> = defineGenerationVariant({
  FC: { logo: [200, 40], character: [120, 144] },
  SFC: { logo: [200, 40], character: [130, 156] },
  PS1: { logo: [250, 50], character: [150, 180] },
  PS2: { logo: [500, 100], character: [280, 336] },
});

const TITLE_BACKGROUNDS = defineGenerationVariant({
  FC: '#120d2a',
  SFC: '#171039',
  PS1: '#1b1240',
  PS2: '#21154a',
});

const TITLE_SPRITE_ALPHA: GenerationVariant<Pick<SpriteCommand, 'alphaCutoff' | 'hardwareBlend'>> =
  defineGenerationVariant({
    FC: { alphaCutoff: 0.5 },
    SFC: { alphaCutoff: 0.5 },
    PS1: { alphaCutoff: 0.5 },
    PS2: { alphaCutoff: 0.5 },
  });

export interface TitleModuleOptions {
  readonly reducedMotion?: () => boolean;
  readonly fixedTimeSeconds?: number;
  readonly fixedPose?: CharacterPose;
  readonly fixedEyes?: EyeFrame;
}

export function buildTitleRenderFrame(
  frame: RenderFrame,
  timeSeconds: number,
  reducedMotion: boolean,
  fixedPose?: CharacterPose,
  fixedEyes?: EyeFrame,
): void {
  frame.timeSeconds = timeSeconds;
  for (const generation of GENERATION_IDS) {
    const hardware = HARDWARE_GENERATION_PROFILES[generation];
    const size = TITLE_ASSET_SIZES[generation];
    const assets = TITLE_GENERATION_ASSETS[generation];
    const sampledAnimation = titleAnimationFrame(hardware, timeSeconds, reducedMotion);
    const animation = {
      ...sampledAnimation,
      pose: fixedPose ?? sampledAnimation.pose,
      eyes: fixedEyes ?? sampledAnimation.eyes,
      tween: fixedPose
        ? { from: fixedPose, to: fixedPose, progress: 0 }
        : sampledAnimation.tween,
    };
    const characterCenter = [
      hardware.video.internalWidth / 2,
      hardware.video.internalHeight - size.character[1] / 2,
    ] as const;
    frame.backgrounds.push({
      color: TITLE_BACKGROUNDS[generation],
      generations: [generation],
    });
    frame.sprites.push({
      id: `title-logo:${generation}`,
      generations: [generation],
      screenSpace: true,
      position: [hardware.video.internalWidth / 2, 8 + size.logo[1] / 2, 0],
      size: size.logo,
      color: '#ffffff',
      texture: assets.logo,
      ...TITLE_SPRITE_ALPHA[generation],
      layer: 0,
      depthWrite: false,
    });
    frame.sprites.push({
      id: `character:${generation}`,
      generations: [generation],
      screenSpace: true,
      position: [characterCenter[0], characterCenter[1], 0],
      size: size.character,
      color: '#ffffff',
      texture: assets.characterBodies[animation.tween.from],
      ...(animation.tween.from !== animation.tween.to
        ? {
            tweenTexture: assets.characterBodies[animation.tween.to],
            textureMix: animation.tween.progress,
          }
        : {}),
      ...TITLE_SPRITE_ALPHA[generation],
      layer: 1,
      depthWrite: false,
    });
    if (generation === 'PS2' || animation.eyes !== 'open') {
      const patch = eyePatchLayout(size.character, generation);
      frame.sprites.push({
        id: `character-eyes:${generation}`,
        generations: [generation],
        screenSpace: true,
        position: [
          characterCenter[0] + patch.offset[0],
          characterCenter[1] + patch.offset[1],
          0,
        ],
        size: patch.size,
        color: '#ffffff',
        texture: assets.characterFrames[characterFrameKey(animation.tween.from, animation.eyes)],
        ...(animation.tween.from === animation.tween.to
          ? {}
          : {
              tweenTexture: assets.characterFrames[
                characterFrameKey(animation.tween.to, animation.eyes)
              ],
              textureMix: animation.tween.progress,
            }),
        ...TITLE_SPRITE_ALPHA[generation],
        layer: 2,
        depthWrite: false,
      });
    }
  }
}

export function createTitleModule(options: TitleModuleOptions = {}): GameModule {
  return {
    id: 'asset-pipeline-title',
    async create(context) {
      const actions = createTitleActionMap();
      const disconnectAudio = context.events.on('generationSwitch', ({ to }) => {
        context.audio.useScore(arrangeTitleScore(HARDWARE_GENERATION_PROFILES[to]));
      });
      context.audio.playScore(arrangeTitleScore(context.generation.profile));
      let timeSeconds = 0;
      return {
        prepareFixedUpdate({ dtMs }): void {
          const snapshot = actions.sample(context.input.snapshot, context.generation.profile, dtMs);
          if (snapshot.switchPrevious.pressed) context.generation.cycle(-1);
          if (snapshot.switchNext.pressed) context.generation.cycle(1);
          const direct = [snapshot.switch1, snapshot.switch2, snapshot.switch3, snapshot.switch4]
            .findIndex((button) => button.pressed);
          if (direct >= 0) context.generation.request(GENERATION_IDS[direct] ?? 'FC');
        },
        fixedUpdate({ dtSeconds }): void {
          timeSeconds += dtSeconds;
        },
        buildRenderFrame(frame): void {
          buildTitleRenderFrame(
            frame,
            options.fixedTimeSeconds ?? timeSeconds,
            options.reducedMotion?.() ?? false,
            options.fixedPose,
            options.fixedEyes,
          );
        },
        dispose(): void {
          disconnectAudio();
          actions.reset();
        },
      };
    },
  };
}
