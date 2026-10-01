import { pick } from '@console-chaos/engine';
import { bodyOf, playerTouches, setSolid, type PuzzleContext } from './types';

export function flickerPath(tileCount: number, safeCount: number, seed: number): number[] {
  const safe: number[] = [];
  let position = 0;
  for (let step = 0; step < safeCount + 1; step++) {
    const remaining = safeCount - step;
    const distance = tileCount + 1 - position;
    const low = Math.max(1, distance - 3 * remaining);
    const high = Math.min(3, distance - remaining);
    position += low + pick(high - low + 1, seed, step);
    if (remaining > 0) safe.push(position);
  }
  return safe;
}

/** The curtain provides information; crossing is valid in any channel. */
export function updateFlickerPath(ctx: PuzzleContext, tileCount: number, safeCount: number, swarmCount: number): void {
  const safe = flickerPath(tileCount, safeCount, ctx.attemptSeed);
  if (!ctx.memory.has('pathInitialized')) {
    for (let index = 1; index <= tileCount; index++) setSolid(ctx, 'f2_tile_' + index, true);
    ctx.memory.set('pathInitialized', 1);
  }
  safe.forEach((tile, index) => {
    const body = bodyOf(ctx, 'f2_tile_' + tile)!;
    const lamp = bodyOf(ctx, 'f2_lamp_' + (index + 1))!;
    lamp.position = [body.position[0], body.position[1] + body.halfExtents[1] + 1.5, lamp.position[2]];
  });
  for (let index = 1; index <= swarmCount; index++) {
    const body = bodyOf(ctx, 'f2_swarm_' + index)!;
    const key = 'baseY:' + index;
    if (!ctx.memory.has(key)) ctx.memory.set(key, body.position[1]);
    body.position[1] = ctx.memory.get(key)! + 0.75 * Math.sin((ctx.tickIndex / 150 + index / swarmCount) * Math.PI * 2);
  }
  for (let index = 1; index <= tileCount; index++) {
    if (!safe.includes(index) && playerTouches(ctx, 'f2_tile_' + index, 0.06)) setSolid(ctx, 'f2_tile_' + index, false);
  }
  if (playerTouches(ctx, 'f2_pedestal')) ctx.markSolved();
}
