/**
 * 紋（ハート）の形（KV-09。SG-10 で `make-textures.ts` から出した）。
 *
 * 基準画の意匠であるハートを、**横棒の階段だけ**で組む。曲線を使わないのは 2 つの理由から。
 *   - §9.1「直線・規則的な構造を持たせる」。第3世代のアフィン歪みは直線が曲がって初めて見える
 *   - 平坦な塗りのまま、16 画素まで縮んでも輪郭が残る
 *
 * **目標も仕掛けもこの 1 つの形に揃える**（上位計画 §3 の決定 6）。
 * ここを 2 つのツール（手続きで描く `make-textures.ts` と、
 * 外部素材へ重ねる `import-textures.ts`）が同じ形として読む。
 * 形が 2 か所に散ると、台座の紋と門の紋がいつか食い違う。
 */

/** [上端 y, 左, 右)。上の 2 段は左右の山、以降は 1 つの塊が細っていく。64 画素の枠が基準 */
export const HEART_ROWS: ReadonlyArray<readonly [number, number, number]> = [
  [12, 12, 26], [12, 38, 52],
  [16, 9, 29], [16, 35, 55],
  [20, 7, 57],
  [24, 7, 57],
  [28, 9, 55],
  [32, 12, 52],
  [36, 16, 48],
  [40, 21, 43],
  [44, 26, 38],
  [48, 30, 34],
];

/** 1 段の高さ（64 画素の枠での値） */
export const HEART_STEP = 4;

/** 紋を組む矩形の一覧。`[x0, y0, x1, y1)` で、`scale` と `offset` は 64 画素の枠からの変換 */
export function heartRects(scale: number, offset = 0): Array<[number, number, number, number]> {
  return HEART_ROWS.map(([y, left, right]) => [
    Math.round(left * scale) + offset,
    Math.round(y * scale) + offset,
    Math.round(right * scale) + offset,
    Math.round((y + HEART_STEP) * scale) + offset,
  ]);
}
