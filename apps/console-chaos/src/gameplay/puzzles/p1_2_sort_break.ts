/**
 * P1-2「ソートの破れ」（GAME_PLAN §6.3、T1-13）。★ 垂直スライスの 6 件
 *
 * 深度バッファを持たない世代では、描画順で解決するため
 * 特定の角度でポリゴンが貫通して見える箇所がある。
 * **見えているとおりに当たり判定も貫通している**ので、殻の内部へ入れる。
 *
 * 成立条件は 2 つの組み合わせ:
 *   1. 奥行きがある（2D 投影では殻の中も外も同じ場所になり、そもそも「内部」が無い）
 *   2. 深度バッファを持たない（順序で解決するため破れが生じる）
 *
 * この 2 つを同時に満たすのは第3世代だけだが、条件はプロファイルの値で書いてあり、
 * 世代 ID には触れていない（不変条件 I2）。
 */
import type { GenerationProfile } from '@/generation/profiles';
import { playerTouches, setSolid, type PuzzleContext, type PuzzleDefinition } from './types';

/** 殻（見た目）。**どの世代でも消えない**。T1-27 で当たり判定を板ごとに分けた */
export const P1_2_SHELL = 'p1_2_shell';
/**
 * 継ぎ目を塞ぐ板。**破れている世代ではここだけが通れるようになる。**
 *
 * 改訂前は「殻の実体を丸ごと入り切りする」形だったが、それでは
 * どこから入れるのかが画面に出ない（計画 §2.3）。裂けて見える場所と
 * 通れる場所を一致させるため、穴は継ぎ目 1 箇所に限る。
 * 座標は `tools/blender_export_shell.py` が正本（`tests/unit/shell_shape.test.ts` が照合する）。
 */
export const P1_2_SEAM = 'p1_2_seam';
/** 殻の内部の核 */
export const P1_2_CORE = 'p1_2_core';

function sortBreaks(profile: GenerationProfile): boolean {
  return profile.video.projection === 'perspective3d' && !profile.video.depthBuffer;
}

export const p1SortBreak: PuzzleDefinition = {
  id: 'P1-2',
  summary: '深度バッファを持たない 3D 世代では殻の描画順が破れ、当たり判定ごとすり抜けて内部に入れる',
  solvableIn: sortBreaks,
  update(ctx: PuzzleContext): void {
    const broken = sortBreaks(ctx.profile);
    // 破れている世代でだけ**継ぎ目**を通り抜けられる。殻の他の面は常に壁のまま。
    // 裂けて見える場所と、通れる場所が同じ 1 箇所になる
    setSolid(ctx, P1_2_SEAM, !broken);
    if (broken && playerTouches(ctx, P1_2_CORE)) ctx.markSolved();
  },
};
