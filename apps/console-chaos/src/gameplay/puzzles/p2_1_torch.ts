/**
 * P2-1「暗闇と松明」（GAME_PLAN §6.4、T1-14 → T2-04 で作り直し）。★ 垂直スライスの 6 件
 *
 * 改訂前は「透明な巨大オブジェクトの影から位置を読む」だったが、
 * 影が薄すぎて読めず、しかも塊が**透明なまま実体を持って**通せんぼしていた
 *（ギミックレビュー P2-1、`Docs/PHASE2_GIMMICK_PLAN.md` §2.3）。塊は削除した。
 *
 * 作り直した部屋は**真っ暗な空洞**で、渡り廊下だけが宙に浮いている。
 *
 * - 廊下は 6 枚の板が繋がったもので、**繋がり方は試行ごとに変わる**（決定 3）。
 *   踏み外せば落ちる。覚えても意味がない
 * - 動的ライティングを持つ世代（CH 4）では、プレイヤーが**松明**を持つ。
 *   足元から数 m だけが照らされ、板の縁と、次の板がどちらへ折れているかが見える
 * - 持たない世代では、部屋は環境光 0.05 のまま。**文字どおり何も見えない**
 * - 刻印は松明に照らされている間だけ反応する（総当たり対策。T1-14 の判断を踏襲）
 *
 * **奥行きが潰れている世代（CH 1 / CH 2）では、板の折れは投影で消える。**
 * Z の違う板が同じ場所に見えるので、廊下は 1 本の線になり、暗くても渡れてしまう。
 * これは投影ルール（不変条件 I1）の一貫した帰結であり、抜け道ではない
 *（渡れても刻印は反応しないので、P2-1 が解けるのは CH 4 だけのまま）。
 */
import { pick } from '@console-chaos/engine';
import type { ConsoleChaosGenerationView } from '@/config/generation';
import { bodyOf, boxOf, playerTouches, type PuzzleContext, type PuzzleDefinition } from './types';

/** 渡り廊下の板の数 */
export const P2_1_SLAB_COUNT = 6;

export const P2_1_SLAB_IDS: readonly string[] = Array.from(
  { length: P2_1_SLAB_COUNT },
  (_, index) => `p2_1_slab_${index + 1}`,
);

/** 廊下の先の刻印。松明に照らされている間だけ反応する */
export const P2_1_MARK = 'p2_1_mark';

/** 板が取りうる Z（m）。隣どうしの差は 2m までなので、必ず歩いて移れる */
export const P2_1_LANE_Z: readonly number[] = [-4, -2, 0, 2, 4];

/** 覚え書きの鍵 */
const BASE_X = 'baseX';
const BASE_Y = 'baseY';

/** 松明を持つか（＝動的ライティングを持つか） */
function hasTorch(profile: ConsoleChaosGenerationView): boolean {
  return profile.hardware.video.dynamicLight;
}

/**
 * この試行の廊下の形（板ごとの Z の添字）。
 *
 * 隣の板との差は 1 レーン（2m）までに抑える。板の幅は 2m なので、
 * 隣り合う板は必ず辺を接し、**歩いて移れる**（跳躍を要求しない）。
 * 状態を持たず、種から毎回引き直す（不変条件 I4）。
 */
export function causewayOf(attemptSeed: number): number[] {
  const lanes: number[] = [];
  let lane = Math.floor(P2_1_LANE_Z.length / 2);
  for (let index = 0; index < P2_1_SLAB_COUNT; index++) {
    if (index > 0) {
      // -1 / 0 / +1 の中から、範囲に収まるものだけを選ぶ
      const low = Math.max(0, lane - 1);
      const high = Math.min(P2_1_LANE_Z.length - 1, lane + 1);
      lane = low + pick(high - low + 1, attemptSeed, index);
    }
    lanes.push(lane);
  }
  return lanes;
}

/** レベルデータが持つ本来の位置を 1 度だけ覚える（座標の正本はレベル側。§5.9） */
function remember(ctx: PuzzleContext, key: string, id: string, axis: 0 | 1): number {
  const stored = ctx.memory.get(`${key}:${id}`);
  if (stored !== undefined) return stored;
  const box = boxOf(ctx, id);
  const value = box ? (box.min[axis] + box.max[axis]) / 2 : 0;
  ctx.memory.set(`${key}:${id}`, value);
  return value;
}

export const p2Torch: PuzzleDefinition = {
  id: 'P2-1',
  summary: '真っ暗な空洞に架かる渡り廊下。松明を持つ世代でだけ、板の縁と折れが見える',
  solvableIn: hasTorch,
  update(ctx: PuzzleContext): void {
    const lanes = causewayOf(ctx.attemptSeed);

    // --- 廊下をこの試行の形に組む ---
    P2_1_SLAB_IDS.forEach((id, index) => {
      const slab = bodyOf(ctx, id);
      if (!slab) return;
      // X と Y はレベルデータのまま。折れるのは Z だけ
      slab.position[0] = remember(ctx, BASE_X, id, 0);
      slab.position[1] = remember(ctx, BASE_Y, id, 1);
      slab.position[2] = P2_1_LANE_Z[lanes[index] ?? 0] ?? 0;
    });

    // 宣言した世代以外で解けないよう、成立条件そのものを解決の前提にする
    if (hasTorch(ctx.profile) && playerTouches(ctx, P2_1_MARK)) ctx.markSolved();
  },
};
