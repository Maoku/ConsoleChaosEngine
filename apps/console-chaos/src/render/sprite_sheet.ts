/**
 * スプライトシートの読み方（T2-09）。
 *
 * **GL を一切知らない純粋な計算だけを置く。** 「今どのコマか」「そのコマは絵のどこか」は
 * 単体テストで確かめられる形にしておきたいので、`renderer3d.ts` から切り出してある。
 *
 * コマ落ちの扱いがボーンアニメと違う点に注意（asset-rules.md §6 との対比）。
 * ボーンアニメは滑らかなものを 1 本だけ作り、世代ごとの粗さを**再生時刻の量子化**で出す。
 * スプライトは**素材そのものが既にコマの列**なので、量子化する余地が無い。
 * 刻みは素材が持つ間隔（`PlayerSpriteClip.frameSeconds`）をそのまま使う。
 */
import type { PlayerSpriteClip, PlayerSpriteProfile } from '@/config/generation';
import type { UvRect } from '@console-chaos/engine';

/** アトラスに入るセルの総数 */
export function spriteCellCount(sheet: PlayerSpriteProfile): number {
  return sheet.columns * sheet.rows;
}

/**
 * 再生時刻から**アトラス内のセル番号**を求める。
 *
 * `loop` が偽のクリップは末尾のコマで止まる。ジャンプは滞空時間のほうが長くなり得るので、
 * 戻して繰り返すと着地の直前に踏み切りの絵が出てしまう。
 */
export function spriteCellOf(clip: PlayerSpriteClip, seconds: number): number {
  const step = Math.max(0, Math.floor(Math.max(seconds, 0) / clip.frameSeconds));
  const index = clip.loop ? step % clip.frames : Math.min(step, clip.frames - 1);
  return clip.first + index;
}

/** セル番号 → アトラス上の UV。原点は左上（画像をそのまま読む向き） */
export function spriteUvRect(sheet: PlayerSpriteProfile, cell: number): UvRect {
  const column = cell % sheet.columns;
  const row = Math.floor(cell / sheet.columns);
  return {
    u0: column / sheet.columns,
    v0: row / sheet.rows,
    u1: (column + 1) / sheet.columns,
    v1: (row + 1) / sheet.rows,
  };
}
