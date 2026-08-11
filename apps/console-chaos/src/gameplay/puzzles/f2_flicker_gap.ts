/**
 * F-2「ちらつきの隙間」（GAME_PLAN §6.1、T1-10 → T2-02 で作り直し）。★ 垂直スライスの 6 件
 *
 * **ちらつきは当たり判定ではなく、ヒントである。**
 *
 * 改訂前は「消えたスプライトは当たり判定も消えるので、その隙間を走り抜ける」だった。
 * 実機では表示が消えても存在は残るため、この規則は遊ぶ側の直感と噛み合わなかった
 *（ギミックレビュー F-2）。当たり判定との連動そのものを廃止し（決定 2）、
 * ちらつきは**答えを覗かせるための現象**として使い直す。
 *
 * 部屋の作り:
 *
 * - 谷は 11m。渡れるのは 10 枚の踏み石だけで、**そのうち 4 枚しか体重を支えない**。
 *   偽の石は触れた瞬間に崩れる。どれが本物かは見ただけでは分からない
 * - 奥の壁に 4 つの灯（`f2_lamp_*`）があり、**本物の石の真上に灯っている**。これが答え
 * - 灯の手前には、群れ（`f2_swarm_*`）の**幕**が張ってある。灯は幕に隠れて見えない
 * - 走査線あたりのスプライト上限を超える世代では、幕の**あふれた分が表示されない**。
 *   群れは漂っているので、あふれる組は毎フレーム入れ替わる ＝ **幕がちらつく**。
 *   その裂け目から、奥の灯が一瞬ずつ覗く
 *
 * 上限を持たない世代では幕は完全なままで、灯は**くっきり隠れている**。
 * 「見えないから読めない」のではなく「隙間ができないから読めない」。
 *
 * 正解は**試行ごとに変わる**（決定 3）。落ちてやり直すたびに石の並びが変わるので、
 * 覚えても意味がなく、毎回ちらつきを読むことになる。
 */
import { pick } from '@console-chaos/engine';
import type { ConsoleChaosGenerationView } from '@/config/generation';
import { bodyOf, boxOf, moveTo, playerTouches, setSolid, type PuzzleContext, type PuzzleDefinition } from './types';

/** 幕を張る群れの数。走査線の上限（第1世代は 8）より多いことが成立条件 */
export const F2_SWARM_COUNT = 12;

/** 谷に並ぶ踏み石の数 */
export const F2_TILE_COUNT = 10;

/** 本物の石の数（= 灯の数）。歩幅の取り方をここで決めている（§ `routeOf`） */
export const F2_SAFE_COUNT = 4;

/** 一歩で跳べる石の数の上限。3 石 = 3m で、第1世代の飛距離（3.35m）に収まる */
const MAX_STEP = 3;

export const F2_TILE_IDS: readonly string[] = Array.from(
  { length: F2_TILE_COUNT },
  (_, index) => `f2_tile_${index + 1}`,
);

export const F2_SWARM_IDS: readonly string[] = Array.from(
  { length: F2_SWARM_COUNT },
  (_, index) => `f2_swarm_${index + 1}`,
);

export const F2_LAMP_IDS: readonly string[] = Array.from(
  { length: F2_SAFE_COUNT },
  (_, index) => `f2_lamp_${index + 1}`,
);

/** 谷の先の台座 */
export const F2_PEDESTAL = 'f2_pedestal';

/** 群れの漂い（振幅 m / 周期ティック）。走査線をまたぐ動きであることが要点 */
const DRIFT_AMPLITUDE = 0.75;
const DRIFT_PERIOD_TICKS = 150;

/** 灯を石の何 m 上に置くか */
const LAMP_HEIGHT = 1.5;

/** 崩れたと見なす余白（m） */
const TOUCH_MARGIN = 0.06;

/** 覚え書きの鍵 */
const ATTEMPT = 'attempt';

/** 幕の一部があふれるか（＝ 走査線の上限が群れの数より少ないか） */
function flickers(profile: ConsoleChaosGenerationView): boolean {
  const limit = profile.hardware.video.spritesPerScanline;
  // -1 は「制限なし」。0 以下はあふれない
  return limit > 0 && limit < F2_SWARM_COUNT;
}

/**
 * この試行の正解（本物の石の番号。1 始まり）。
 *
 * 手前の岸（石 0 の位置）から向こう岸（石 `F2_TILE_COUNT + 1` の位置）まで、
 * 1〜3 石の歩幅で `F2_SAFE_COUNT + 1` 歩で渡り切る道を引く。
 * **状態を持たず、種から毎回引き直す**ので、途中でずれようがない（不変条件 I4）。
 *
 * 歩幅は「残りの歩数で必ず渡り切れる範囲」に限ってから選ぶので、
 * どの種でも必ず成立する道が出る（行き止まりを作らない）。
 */
export function routeOf(attemptSeed: number): number[] {
  const steps = F2_SAFE_COUNT + 1;
  const safe: number[] = [];
  let position = 0;
  for (let step = 0; step < steps; step++) {
    const remainingSteps = steps - step - 1;
    const remainingDistance = F2_TILE_COUNT + 1 - position;
    // 残り `remainingSteps` 歩で詰められる範囲に歩幅を収める
    const low = Math.max(1, remainingDistance - MAX_STEP * remainingSteps);
    const high = Math.min(MAX_STEP, remainingDistance - remainingSteps);
    const width = Math.max(1, high - low + 1);
    position += low + pick(width, attemptSeed, step);
    if (remainingSteps > 0) safe.push(position);
  }
  return safe;
}

/** 漂いの位置。ティック番号から出すので、リプレイでも同じちらつきになる */
function driftAt(tickIndex: number, index: number): number {
  const phase = (tickIndex / DRIFT_PERIOD_TICKS + index / F2_SWARM_COUNT) * Math.PI * 2;
  return DRIFT_AMPLITUDE * Math.sin(phase);
}

export const f2FlickerGap: PuzzleDefinition = {
  id: 'F-2',
  summary: '走査線からあふれた群れがちらつき、その裂け目から、本物の踏み石を示す灯が覗く',
  solvableIn: flickers,
  update(ctx: PuzzleContext): void {
    const active = flickers(ctx.profile);
    const safe = routeOf(ctx.attemptSeed);

    // --- 試行が変わったら、崩れた石を戻す ---
    if (ctx.memory.get(ATTEMPT) !== ctx.attemptSeed) {
      ctx.memory.set(ATTEMPT, ctx.attemptSeed);
      for (const id of F2_TILE_IDS) setSolid(ctx, id, true);
    }

    // --- 灯を本物の石の真上へ置く（これが答えそのもの） ---
    F2_LAMP_IDS.forEach((lampId, index) => {
      const tileIndex = safe[index];
      if (tileIndex === undefined) return;
      const tile = boxOf(ctx, F2_TILE_IDS[tileIndex - 1] ?? '');
      const lamp = bodyOf(ctx, lampId);
      if (!tile || !lamp) return;
      moveTo(ctx, lampId, [(tile.min[0] + tile.max[0]) / 2, tile.max[1] + LAMP_HEIGHT, lamp.position[2]]);
    });

    // --- 幕を漂わせる。走査線をまたいで動くので、あふれる組が入れ替わる ---
    F2_SWARM_IDS.forEach((swarmId, index) => {
      const swarm = bodyOf(ctx, swarmId);
      if (!swarm) return;
      const base = ctx.memory.get(swarmId);
      const baseY = base ?? swarm.position[1];
      if (base === undefined) ctx.memory.set(swarmId, baseY);
      swarm.position[1] = baseY + driftAt(ctx.tickIndex, index);
    });

    // --- 偽の石は触れた瞬間に崩れる ---
    F2_TILE_IDS.forEach((tileId, index) => {
      if (safe.includes(index + 1)) return;
      if (playerTouches(ctx, tileId, TOUCH_MARGIN)) setSolid(ctx, tileId, false);
    });

    // 宣言した世代以外で解けないよう、成立条件そのものを解決の前提にする
    if (active && playerTouches(ctx, F2_PEDESTAL)) ctx.markSolved();
  },
};
