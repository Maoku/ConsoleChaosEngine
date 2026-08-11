/**
 * 曲の目録（選曲）。
 *
 * **世代切替と選曲は別物。** 世代切替は「同じ曲を、その時代の音と編成で鳴らす」で、
 * 小節位置が保たれることが受け入れ条件になっている（T0-18 / T1-16）。
 * 選曲は「鳴らす曲そのものを変える」ので、テンポが違えば位相は保てない。
 * この 2 つを混ぜないために、目録は `music.ts`（作品）からも
 * `director.ts`（世代と音源の対応）からも分けて、ここに置く。
 *
 * 曲を足すときに触るのはこの表だけ。`arrangeFor` は曲を選ばない
 *（4 編曲の約束は曲を跨いで同じ）。
 */
import { AREA1_SONG_CALM, AREA1_SONG_POP } from './music';
import type { Score } from './score';

export type SongId = 'pop' | 'calm';

export interface SongEntry {
  id: SongId;
  /** 画面に出す名前。ルールの説明にならない範囲の言葉だけを使う */
  title: string;
  score: Score;
}

/** 並び順がそのまま切替の巡回順になる */
export const SONGS: readonly SongEntry[] = [
  { id: 'pop', title: 'パレットの回廊（ポップ）', score: AREA1_SONG_POP },
  { id: 'calm', title: 'パレットの回廊（原曲）', score: AREA1_SONG_CALM },
];

export const DEFAULT_SONG_ID: SongId = 'pop';

/** 目録から引く。未知の ID は既定の曲に落とす（URL パラメータなど外から来る値のため） */
export function songOf(id: string | null | undefined): SongEntry {
  return SONGS.find((song) => song.id === id) ?? SONGS.find((song) => song.id === DEFAULT_SONG_ID)!;
}

/** 次の曲へ巡回する。末尾の次は先頭 */
export function nextSongId(id: SongId): SongId {
  const index = SONGS.findIndex((song) => song.id === id);
  return SONGS[(index + 1) % SONGS.length]!.id;
}
