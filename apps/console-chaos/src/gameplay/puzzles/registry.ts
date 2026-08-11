/**
 * パズル ID → 定義の登録（IMPLEMENTATION_PLAN §5.9 / §7.3、T1-07 で骨格）。
 *
 * ここが**唯一の登録先**。レベルデータの `puzzleId` はこの表を指し、
 * CI（`npm run check:levels`）はこの表を丸ごと読んで
 * 各定義の `solvableIn` を 4 世代で評価する。
 *
 * ★ 垂直スライスの 6 件（T1-09〜14）をここで登録する。
 * パズルを足すときにこのファイルへ 1 行加えることが、CI に載せる唯一の手続きになる。
 */
import { PROFILES, type GenerationId } from '@/generation/profiles';
import type { PuzzleDefinition } from './types';
import { f1ColorCrush } from './f1_color_crush';
import { f2FlickerGap } from './f2_flicker_gap';
import { s1AffinePlane } from './s1_affine_plane';
import { p1BackSide } from './p1_1_backside';
import { p1SortBreak } from './p1_2_sort_break';
import { p2Torch } from './p2_1_torch';

const definitions = new Map<string, PuzzleDefinition>();

export function registerPuzzle(definition: PuzzleDefinition): PuzzleDefinition {
  if (definitions.has(definition.id)) {
    throw new Error(`パズル ID が重複している: ${definition.id}`);
  }
  definitions.set(definition.id, definition);
  return definition;
}

export function getPuzzle(id: string): PuzzleDefinition | undefined {
  return definitions.get(id);
}

/** 登録順で返す（CI の出力とリプレイの再現性のため。不変条件 I4） */
export function allPuzzles(): PuzzleDefinition[] {
  return [...definitions.values()];
}

/** テスト用。本番では呼ばない */
export function clearPuzzles(): void {
  definitions.clear();
}

/** ★ 垂直スライスの 6 件。読み込み時に登録する */
export const VERTICAL_SLICE_PUZZLES: readonly PuzzleDefinition[] = [
  f1ColorCrush,
  f2FlickerGap,
  s1AffinePlane,
  p1BackSide,
  p1SortBreak,
  p2Torch,
];

for (const definition of VERTICAL_SLICE_PUZZLES) registerPuzzle(definition);

/**
 * CI が使う形（`level/schema.ts` の `PuzzleGenerationCheck`）へ変換する。
 * 世代 ID からプロファイルを引く責任をここに閉じ込め、level/ を gameplay/ から独立させる。
 */
export function generationChecks(): Array<{ id: string; solvableIn(generation: GenerationId): boolean }> {
  return allPuzzles().map((definition) => ({
    id: definition.id,
    solvableIn: (generation: GenerationId) => definition.solvableIn(PROFILES[generation]),
  }));
}
