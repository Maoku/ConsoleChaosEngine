import type { HardwareGenerationProfile } from '@console-chaos/engine';
import type { StagePuzzle } from './stage-schema';

export function stageCompletionIn(instance: Pick<StagePuzzle, 'kind' | 'variant'>, profile: HardwareGenerationProfile): boolean {
  const video = profile.video;
  switch (instance.kind) {
    case 'F-1': return video.paletteMode === 'fixed54' ||
      (instance.variant === 'crossing' && video.projection === 'perspective3d');
    case 'F-2': return true;
    case 'S-1': return true;
    case 'P1-1': return video.projection === 'perspective3d';
    case 'P1-2': return video.projection === 'perspective3d' && !video.depthBuffer;
    case 'P2-1': return video.dynamicLight;
  }
}
