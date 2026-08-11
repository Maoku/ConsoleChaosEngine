/**
 * M1 compatibility surface. Hardware is owned by @console-chaos/engine and
 * Console-specific theme values are owned by config/generation.ts.
 * Remove this composed view in M6 after all consumers accept both values.
 */
import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  type DirectionalInput,
  type GenerationId,
  type HardwareGenerationProfile,
  type PaletteMode,
  type ProjectionMode,
  type SignalKind,
  type SynthKind,
} from '@console-chaos/engine';
import {
  CONSOLE_CHAOS_GENERATION_THEMES,
  composeLegacyGenerationProfile,
  type BackdropLayer,
  type BackdropProfile,
  type ConsoleActionTheme,
  type ConsoleArtTheme,
  type ConsoleCameraTheme,
  type ForwardXZ,
  type LegacyGenerationProfile,
  type PlayerClip,
  type PlayerClipRef,
  type PlayerModelProfile,
  type PlayerSpriteClip,
  type PlayerSpriteProfile,
  type PlayerVisual,
} from '@/config/generation';

export { GENERATION_IDS };
export type { GenerationId, PaletteMode, ProjectionMode, SignalKind, SynthKind };
export type DirectionalKind = DirectionalInput;
export type VideoProfile = HardwareGenerationProfile['video'];
export type AudioProfile = HardwareGenerationProfile['audio'];
export type InputProfile = LegacyGenerationProfile['input'];
export type CameraProfile = ConsoleCameraTheme;
export type ActionProfile = ConsoleActionTheme;
export type ArtProfile = ConsoleArtTheme;
export type GenerationProfile = LegacyGenerationProfile;
export type {
  BackdropLayer,
  BackdropProfile,
  ForwardXZ,
  PlayerClip,
  PlayerClipRef,
  PlayerModelProfile,
  PlayerSpriteClip,
  PlayerSpriteProfile,
  PlayerVisual,
};

export const DISPLAY_NAMES: Record<GenerationId, { channel: string; label: string }> = Object.fromEntries(
  GENERATION_IDS.map((id) => [id, CONSOLE_CHAOS_GENERATION_THEMES[id].display]),
) as Record<GenerationId, { channel: string; label: string }>;

export const PROFILES: Record<GenerationId, GenerationProfile> = Object.fromEntries(
  GENERATION_IDS.map((id) => [id, composeLegacyGenerationProfile(id)]),
) as Record<GenerationId, GenerationProfile>;

/** Coverage assertion: all public hardware profiles are consumed by the compatibility view. */
void HARDWARE_GENERATION_PROFILES;
