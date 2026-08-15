export const BAYER_4X4: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

export const BAYER_8X8: readonly (readonly number[])[] = (() => {
  const output: number[][] = [];
  for (let y = 0; y < 8; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < 8; x += 1) {
      row.push((BAYER_4X4[y % 4]?.[x % 4] ?? 0) * 4 + (BAYER_4X4[Math.floor(y / 4)]?.[Math.floor(x / 4)] ?? 0));
    }
    output.push(row);
  }
  return output;
})();

/** Ordered threshold in the -0.5..0.5 range. */
export function bayerThreshold(x: number, y: number): number {
  return ((BAYER_8X8[y & 7]?.[x & 7] ?? 0) + 0.5) / 64 - 0.5;
}

export const bayer = bayerThreshold;
