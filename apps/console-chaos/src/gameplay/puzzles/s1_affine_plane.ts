/**
 * S-1「回る床」（GAME_PLAN §6.2、T1-11 → T2-03 で作り直し）。★ 垂直スライスの 6 件
 *
 * 改訂前は「半透明の足場」だったが、谷が 4m しかなく**どの世代でも跳び越せていた**
 *（ギミックレビュー S-1、`Docs/PHASE2_GIMMICK_PLAN.md` §2.1）。
 * 谷を 9m にして跳躍で渡る道を塞ぎ、代わりに第2世代だけが持つ
 * **画面いっぱいの面を回転・拡大する機能**（`video.affinePlane`）を成立条件に据えた。
 *
 * 円形の空洞。床は 1 枚の巨大な面で、その面が回る世代では**画面全体が回る**。
 * 向こう岸の島は面に固定されているので、面と一緒に軸のまわりを公転し、
 * 一定の周期でこちらの岸へ近づく。近づいた隙に飛び移る。
 *
 * - 面が回らない世代（CH 1 / CH 3 / CH 4）では、島は向こう側に留まったまま届かない
 * - 岸から島への踏み台は**半透明でしか存在しない**（T1-25 の資産をそのまま使う）。
 *   加算合成を持たない CH 1 では踏み台が無く、島が近づいても渡れない
 *
 * したがって成立条件は「面が回る」かつ「半透明が見える」＝ 第2世代のみ。
 * `affinePlane` は第2世代だけが true なので集合としては前者だけで決まるが、
 * **踏み台が要ることも遊びの一部**なので条件として明示する。
 *
 * **島に乗ったプレイヤーは島と一緒に運ばれる。** 面に固定されているのは島だけではなく、
 * その上に立っているものすべてだからで、これが無いと乗った瞬間に足元だけが逃げていく。
 * 運ばれることで「回る面に乗って向こう岸へ渡る」が成立する。
 */
import type { GenerationProfile } from '@/generation/profiles';
import { bodyOf, playerTouches, setSolid, type PuzzleContext, type PuzzleDefinition } from './types';

/** 公転する島。台座を載せている */
export const S1_ISLAND = 's1_island';
/** 島の上の台座 */
export const S1_PEDESTAL = 's1_pedestal';
/** 岸から島への踏み台。加算合成を持つ世代でだけ実体になる */
export const S1_PLATFORM = 's1_platform';
/**
 * 面の軸。**位置はレベルデータが持つ**（座標の正本はレベル側。§5.9）。
 * 見た目を持たない印で、当たり判定も通り抜ける。描画側も同じ印を読んで面の中心にする
 */
export const S1_PIVOT = 's1_pivot';

/** 面が一巡する時間（ティック）。12 秒。待てば必ず来ると分かる速さ */
export const S1_PERIOD_TICKS = 720;

/** 覚え書きの鍵。レベルデータから読んだ公転半径を保つ */
const RADIUS = 'radius';

/** 島に「乗っている」と見なす余白（m）。真上に立つと境界が接するだけで重ならないため */
const CARRY_MARGIN = 0.06;

/** 面が回るか */
function planeTurns(profile: GenerationProfile): boolean {
  return profile.video.affinePlane;
}

/** 踏み台が見えるか（＝実体を持つか） */
function stepVisible(profile: GenerationProfile): boolean {
  return profile.video.alphaBlend;
}

/**
 * この時刻の面の角度（ラジアン）。
 * ティック番号から出すので、描画とパズルが同じ値を見る（リプレイでも同じ。不変条件 I4）。
 * 0 のとき島は岸に最も近い。
 */
export function planeAngleAt(tickIndex: number): number {
  return ((tickIndex % S1_PERIOD_TICKS) / S1_PERIOD_TICKS) * Math.PI * 2;
}

export const s1AffinePlane: PuzzleDefinition = {
  id: 'S-1',
  summary: '床が 1 枚の面として回る世代でだけ、向こう岸の島が公転してこちらへ近づく',
  solvableIn: (profile) => planeTurns(profile) && stepVisible(profile),
  update(ctx: PuzzleContext): void {
    const turns = planeTurns(ctx.profile);

    // 踏み台は加算合成を持つ世代でだけ実体になる（T1-25 の規則をそのまま使う）
    setSolid(ctx, S1_PLATFORM, stepVisible(ctx.profile));

    const island = bodyOf(ctx, S1_ISLAND);
    const pedestal = bodyOf(ctx, S1_PEDESTAL);
    const pivot = bodyOf(ctx, S1_PIVOT);
    if (island && pedestal && pivot) {
      // 半径はレベルデータの配置から読む（座標の正本はレベル側。§5.9）
      const remembered = ctx.memory.get(RADIUS);
      const radius =
        remembered ?? Math.hypot(island.position[0] - pivot.position[0], island.position[2] - pivot.position[2]);
      if (remembered === undefined) ctx.memory.set(RADIUS, radius);

      // 回らない世代では向こう側（π）で止まったまま。届かない
      const angle = turns ? planeAngleAt(ctx.tickIndex) : Math.PI;

      // 角度 0 で岸側（-X）、π で向こう側（+X）。箱は回さず公転だけさせる（AABB のまま扱える）
      const dx = pivot.position[0] - radius * Math.cos(angle) - island.position[0];
      const dz = pivot.position[2] + radius * Math.sin(angle) - island.position[2];
      island.position[0] += dx;
      island.position[2] += dz;
      // 台座は島に載っているので、同じだけ動かす
      pedestal.position[0] += dx;
      pedestal.position[2] += dz;

      // 島に立っているものは島と一緒に運ばれる。これが無いと足元だけが逃げていく
      if (ctx.player.grounded && playerTouches(ctx, S1_ISLAND, CARRY_MARGIN)) {
        ctx.player.position[0] += dx;
        ctx.player.position[2] += dz;
      }
    }

    // 宣言した世代以外で解けないよう、成立条件そのものを解決の前提にする
    if (turns && stepVisible(ctx.profile) && playerTouches(ctx, S1_PEDESTAL)) ctx.markSolved();
  },
};
