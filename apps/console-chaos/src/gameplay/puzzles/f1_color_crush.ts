/**
 * F-1「色の潰れ」（GAME_PLAN §6.1、T1-09 → T2-01 で作り直し）。★ 垂直スライスの 6 件
 *
 * **ツタそのものが橋である。** 谷は 7m あり、どの世代でも跳び越せない
 *（滞空 0.745 秒 × 最高速 5.5m/s + 体幅 = 実効 4.8m。`Docs/development/PHASE2_GIMMICK_PLAN.md` §2.1）。
 * 渡るにはツタに乗るしかない。
 *
 * 世界のルールは **1 つだけ**：
 *
 *   **黄緑のツタは体重で切れる。緑のツタは保つ。**
 *
 * 世代差はここから導かれる。分岐を書き足すのではなく、同じ規則が投影とパレットの
 * 違いを通ると別の遊びになる（不変条件 I2）。
 *
 * | 世代 | 何が起きるか | 難度 |
 * |---|---|---|
 * | 色が潰れる（CH 1） | 装置が 2 本を同一物と見なして**撚る**。太い 1 本になり、揺れもしない | 簡単 |
 * | 潰れない × 2D（CH 2） | 2 本は別物。**奥行きが潰れているのでどちらに乗るか選べず**、黄緑が受け持って切れる | 渡れない |
 * | 3D（CH 3 / CH 4） | 奥行きがあるので緑を選んで乗れる。ただしツタは細く、**揺れる**ので追い続ける必要がある | 難しいが可能 |
 *
 * **「解ける／解けない」だけでなく「どれだけ楽か」で世代差を出す**という方針の第 1 号
 *（`Docs/development/PHASE2_GIMMICK_PLAN.md` §6 の決定 1）。したがって `solvableIn` は 3 世代を返す。
 */
import type { ConsoleChaosGenerationView } from '@/config/generation';
import { bodyOf, boxOf, playerTouches, setSolid, type PuzzleContext, type PuzzleDefinition } from './types';

/** 緑のツタ。体重を保つ */
export const F1_VINE_A = 'f1_vine_a';
/** 黄緑のツタ。体重で切れる */
export const F1_VINE_B = 'f1_vine_b';
/** 撚り合わさった 1 本。色が潰れている間だけ実体になる */
export const F1_BRAID = 'f1_braid';
/** 谷の向こうの台座。触れると解けたことになる */
export const F1_PEDESTAL = 'f1_pedestal';

/** 黄緑が切れるまで（ティック）。0.5 秒。乗った瞬間ではなく、渡り始めてから切れる */
export const F1_BREAK_TICKS = 30;

/** 揺れの振幅（m）と周期（ティック）。奥行きを持つ世代でだけ効く */
const SWAY_AMPLITUDE = 0.5;
const SWAY_PERIOD_TICKS = 240;

/** 「乗っている」と見なす余白（m）。真上に立つと境界が接するだけで重ならないため */
const TOUCH_MARGIN = 0.06;

/** 覚え書きの鍵（`ctx.memory`。セッションごとに持ち、`reset()` で捨てられる） */
const BASE_Z_A = 'baseZa';
const BASE_Z_B = 'baseZb';
const BREAKING_TICKS = 'breaking';
const BROKEN = 'broken';

/**
 * 2 本のツタが同じ色に潰れるか。
 *
 * 固定パレット（`fixed54`）は色の選択肢そのものが少なく、
 * 近い色相の 2 色は同じ 1 色へ丸められる。RGB555 や truecolor では丸められない。
 */
function vinesCollapse(profile: ConsoleChaosGenerationView): boolean {
  return profile.hardware.video.paletteMode === 'fixed54';
}

/** どちらのツタに乗るかを選べるか（= 奥行きが潰れていないか） */
function choosableDepth(profile: ConsoleChaosGenerationView): boolean {
  return profile.hardware.video.projection === 'perspective3d';
}

/** 揺れの位置。時刻ではなくティック番号から出すので、リプレイでも同じ揺れになる（I4） */
function swayAt(tickIndex: number): number {
  return SWAY_AMPLITUDE * Math.sin((tickIndex / SWAY_PERIOD_TICKS) * Math.PI * 2);
}

/** レベルデータが持つ本来の Z を 1 度だけ覚える（座標の正本はレベル側にある） */
function baseZ(ctx: PuzzleContext, key: string, id: string): number {
  const remembered = ctx.memory.get(key);
  if (remembered !== undefined) return remembered;
  const box = boxOf(ctx, id);
  const z = box ? (box.min[2] + box.max[2]) / 2 : 0;
  ctx.memory.set(key, z);
  return z;
}

/** プレイヤーが谷の上（＝ツタの区間）にいるか。切れたツタを戻してよいかの判断に使う */
function overChasm(ctx: PuzzleContext): boolean {
  const box = boxOf(ctx, F1_VINE_A);
  if (!box) return false;
  const x = ctx.player.position[0];
  return x > box.min[0] - 0.5 && x < box.max[0] + 0.5;
}

export const f1ColorCrush: PuzzleDefinition = {
  id: 'F-1',
  summary: 'ツタ自体が谷に架かる橋。色が潰れる世代では 2 本が撚られて太い 1 本になり、楽に渡れる',
  // 撚られるか（色が潰れる）、乗る糸を選べるか（奥行きがある）のどちらか
  solvableIn: (profile) => vinesCollapse(profile) || choosableDepth(profile),
  update(ctx: PuzzleContext): void {
    const collapsed = vinesCollapse(ctx.profile);

    // --- 揺れ。撚られている間は張って動かない ---
    const zA = baseZ(ctx, BASE_Z_A, F1_VINE_A);
    const zB = baseZ(ctx, BASE_Z_B, F1_VINE_B);
    const sway = collapsed ? 0 : swayAt(ctx.tickIndex);
    const a = bodyOf(ctx, F1_VINE_A);
    const b = bodyOf(ctx, F1_VINE_B);
    if (a) a.position[2] = zA + sway;
    if (b) b.position[2] = zB + sway;

    // --- 黄緑が切れる。世代を問わない、この谷ただ 1 つの規則 ---
    let broken = (ctx.memory.get(BROKEN) ?? 0) === 1;
    if (broken) {
      // 谷から離れて足が着いたら結び直される（落ちて戻ってきた人を二度嵌めない）
      if (!overChasm(ctx) && ctx.player.grounded) {
        broken = false;
        ctx.memory.set(BROKEN, 0);
        ctx.memory.set(BREAKING_TICKS, 0);
      }
    } else if (!collapsed && ctx.player.grounded && playerTouches(ctx, F1_VINE_B, TOUCH_MARGIN)) {
      // 2D では「黄緑に乗らない」を選べない（奥行きが潰れているので両方に触れる）
      const elapsed = (ctx.memory.get(BREAKING_TICKS) ?? 0) + 1;
      ctx.memory.set(BREAKING_TICKS, elapsed);
      if (elapsed >= F1_BREAK_TICKS) {
        broken = true;
        ctx.memory.set(BROKEN, 1);
      }
    } else {
      ctx.memory.set(BREAKING_TICKS, 0);
    }

    // --- 実体 ---
    // 撚られた 1 本と、別々の 2 本は排他。撚っていない 1 本では張力が保てないので、
    // 黄緑が切れると緑も同時に垂れる
    setSolid(ctx, F1_BRAID, collapsed);
    setSolid(ctx, F1_VINE_A, !collapsed && !broken);
    setSolid(ctx, F1_VINE_B, !collapsed && !broken);

    // 宣言した世代以外で解けないよう、成立条件そのものを解決の前提にする
    if ((collapsed || choosableDepth(ctx.profile)) && playerTouches(ctx, F1_PEDESTAL)) ctx.markSolved();
  },
};
