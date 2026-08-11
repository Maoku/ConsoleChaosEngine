import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  type GenerationId,
  type GenerationVariant,
} from '@console-chaos/engine';
import { PROFILES, type GenerationProfile } from '@/generation/profiles';

export interface ConsoleChaosGenerationTheme {
  camera: GenerationProfile['camera'];
  action: GenerationProfile['action'];
  player: GenerationProfile['player'];
  art: GenerationProfile['art'];
  buttons: GenerationProfile['input']['buttons'];
}

export const CONSOLE_CHAOS_GENERATION_THEMES: GenerationVariant<ConsoleChaosGenerationTheme> = Object.fromEntries(
  GENERATION_IDS.map((id) => {
    const profile = PROFILES[id];
    return [id, {
      camera: profile.camera,
      action: profile.action,
      player: profile.player,
      art: profile.art,
      buttons: profile.input.buttons,
    }];
  }),
) as unknown as GenerationVariant<ConsoleChaosGenerationTheme>;

/** 移行中の互換層。engine の hardware と作品固有 theme から旧形を再構成する。 */
export function composeLegacyGenerationProfile(id: GenerationId): GenerationProfile {
  const hardware = HARDWARE_GENERATION_PROFILES[id];
  const theme = CONSOLE_CHAOS_GENERATION_THEMES[id];
  return {
    id,
    video: { ...hardware.video },
    camera: theme.camera,
    audio: { ...hardware.audio },
    input: { ...hardware.input, buttons: theme.buttons },
    action: theme.action,
    player: theme.player,
    art: theme.art,
  };
}

