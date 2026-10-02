import type { StagePuzzle } from '@/content/stage-schema';
import { bodyOf, playerTouches, type PuzzleContext } from './types';

export interface GardenState {
  ticks: number;
  carriedTicks: number;
  angle: number;
  scale: number;
  center: [number, number, number];
  radius: number;
}
export function gardenState(): GardenState {
  return { ticks: 0, carriedTicks: 0, angle: 0, scale: 1, center: [0, 0, 0], radius: 4 };
}
export function gardenPoint(state: GardenState, point: readonly [number, number]): [number, number, number] {
  const c = Math.cos(state.angle), s = Math.sin(state.angle);
  return [state.center[0] + state.scale * (c * point[0] - s * point[1]),
    state.center[1] + state.scale * (s * point[0] + c * point[1]), state.center[2]];
}
export function moveGarden(ctx: PuzzleContext, instance: StagePuzzle, state: GardenState): void {
  const pivot = bodyOf(ctx, 's1_pivot')!;
  const island = bodyOf(ctx, 's1_island')!;
  state.center = [...pivot.position];
  const previous = [...island.position];
  const supported = ctx.support === ctx.entities.get('s1_island');
  if (!ctx.initializing && !ctx.transitioning && ctx.profile.hardware.video.affinePlane &&
      Math.abs(ctx.player.position[0] - pivot.position[0]) <= state.radius + 1.5) {
    state.ticks++;
    if (supported) state.carriedTicks++;
  }
  const period = instance.settings.periodTicks ?? 720;
  state.angle = -state.ticks / period * Math.PI * 2;
  state.scale = 1 + (instance.settings.scaleAmplitude ?? 0.03) * Math.sin(state.angle * 2);
  island.position = gardenPoint(state, [-state.radius, 0]);
  if (supported && !ctx.initializing) {
    for (const axis of [0, 1, 2] as const) ctx.player.position[axis] += island.position[axis] - previous[axis]!;
    // Floating-point top/feet subtraction must not turn the supporting floor into a horizontal wall.
    // Gravity settles this separation in the same tick, before the presentation reads the position.
    ctx.player.position[1] += 1e-7;
  }
}
export function connectGarden(ctx: PuzzleContext, instance: StagePuzzle, state: GardenState): void {
  if (state.carriedTicks >= (instance.settings.periodTicks ?? 720) * 0.3 && playerTouches(ctx, 's1_pedestal')) ctx.markSolved();
}
