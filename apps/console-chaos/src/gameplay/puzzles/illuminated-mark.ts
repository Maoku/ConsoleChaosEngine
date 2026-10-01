import type { StagePuzzle } from '@/content/stage-schema';
import { torchExposure } from '../torch';
import { bodyOf, type PuzzleContext } from './types';
import { causewayOf, P2_1_LANE_Z } from './p2_1_torch';

export function illuminateMark(ctx: PuzzleContext, instance: StagePuzzle): void {
  const lanes = causewayOf(ctx.attemptSeed);
  (instance.bindings.slabs as string[]).forEach((_, index) => {
    const slab = bodyOf(ctx, 'p2_1_slab_' + (index + 1))!;
    slab.position[2] = P2_1_LANE_Z[lanes[index] ?? 2]!;
  });
  const mark = bodyOf(ctx, 'p2_1_mark')!;
  const exposure = ctx.profile.hardware.video.dynamicLight ? torchExposure(ctx.player.position, mark.position) : 0;
  ctx.memory.set('exposure', exposure);
  if (exposure >= (instance.settings.lightThreshold ?? 0.12)) ctx.markSolved();
}
