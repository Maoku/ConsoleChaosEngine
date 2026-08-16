import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  defineGenerationVariant,
  type GameModule,
  type GenerationVariant,
  type RenderFrame,
} from '@console-chaos/engine';
import { createTitleActionMap } from './actions';
import { pivotedSpriteCenter, swayAngle } from './animation';
import { TITLE_GENERATION_ASSETS } from './render-manifest';

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

export interface TitleModuleOptions {
  readonly reducedMotion?: () => boolean;
}

export function buildTitleRenderFrame(
  frame: RenderFrame,
  timeSeconds: number,
  reducedMotion: boolean,
): void {
  frame.timeSeconds = timeSeconds;
  for (const generation of GENERATION_IDS) {
    const hardware = HARDWARE_GENERATION_PROFILES[generation];
    const size = TITLE_ASSET_SIZES[generation];
    const assets = TITLE_GENERATION_ASSETS[generation];
    const angle = swayAngle(hardware, timeSeconds, reducedMotion);
    const characterCenter = pivotedSpriteCenter(
      [hardware.video.internalWidth / 2, hardware.video.internalHeight],
      size.character,
      angle,
    );
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
      rotation: angle,
      texture: assets.character,
      layer: 1,
      depthWrite: false,
    });
  }
}

export function createTitleModule(options: TitleModuleOptions = {}): GameModule {
  return {
    id: 'asset-pipeline-title',
    async create(context) {
      const actions = createTitleActionMap();
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
          buildTitleRenderFrame(frame, timeSeconds, options.reducedMotion?.() ?? false);
        },
        dispose(): void {
          actions.reset();
        },
      };
    },
  };
}
