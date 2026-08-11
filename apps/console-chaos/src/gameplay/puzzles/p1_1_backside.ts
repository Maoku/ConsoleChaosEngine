/**
 * P1-1「裏側」（GAME_PLAN §6.3、T1-12）。★ 垂直スライスの 6 件
 *
 * 2D では平面の壁にしか見えない構造物の、裏に回り込む。
 *
 * **このパズルはコードをほとんど持たない。** 到達できるかどうかは
 * 投影ルール（§5.2）と物理がそのまま決めるからで、
 * 2D 投影では手前の壁が「Z 方向に無限の柱」になり、どうやっても裏へ回れない。
 * パズル側の仕事は「奥行きが見えている世代でのみ解けた」と宣言することだけ。
 *
 * これが本作の設計の理想形：中核ルールが遊びを作り、パズルは配置と宣言に徹する。
 */
import type { GenerationProfile } from '@/generation/profiles';
import { playerTouches, type PuzzleContext, type PuzzleDefinition } from './types';

/** 手前の壁。2D では Z 無限の柱として通せんぼになる */
export const P1_1_WALL = 'p1_1_wall';
/** 壁の裏のスイッチ */
export const P1_1_SWITCH = 'p1_1_switch';

function hasDepth(profile: GenerationProfile): boolean {
  return profile.video.projection === 'perspective3d';
}

export const p1BackSide: PuzzleDefinition = {
  id: 'P1-1',
  summary: '2D では平面の壁に見える構造物の裏へ、奥行きのある世代でだけ回り込める',
  solvableIn: hasDepth,
  update(ctx: PuzzleContext): void {
    // 壁は常に実体。通れないのは投影ルールの結果であって、ギミックの操作ではない
    if (hasDepth(ctx.profile) && playerTouches(ctx, P1_1_SWITCH)) ctx.markSolved();
  },
};
