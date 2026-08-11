/**
 * 第1世代（FC）の 54 色マスターパレット（T0-10、GAME_PLAN §11.3）。
 *
 * 第1世代の映像出力は「固定の色表から選ぶ」方式だった。任意の色を出せず、
 * 表現は**選択の問題**になる。本作の第1世代はこの制約をそのまま採用する。
 *
 * ここは定数のみを持ち、ロジックを持たない。量子化の手続きは palette_fc.ts。
 */

/** マスターパレットの色数 */
export const MASTER_PALETTE_SIZE = 54;

/**
 * sRGB 0..255。輝度の低い順ではなく、当時の色表の並び（色相 × 明度 4 段）に沿って並べる。
 * 4 行 × 13 色 + 背景の 2 色（黒・白）で 54 色。
 */
export const MASTER_PALETTE_RGB: readonly (readonly [number, number, number])[] = [
  // 明度 1（最も暗い）
  [84, 84, 84], [0, 30, 116], [8, 16, 144], [48, 0, 136], [68, 0, 100],
  [92, 0, 48], [84, 4, 0], [60, 24, 0], [32, 42, 0], [8, 58, 0],
  [0, 64, 0], [0, 60, 0], [0, 50, 60],
  // 明度 2
  [152, 150, 152], [8, 76, 196], [48, 50, 236], [92, 30, 228], [136, 20, 176],
  [160, 20, 100], [152, 34, 32], [120, 60, 0], [84, 90, 0], [40, 114, 0],
  [8, 124, 0], [0, 118, 40], [0, 102, 120],
  // 明度 3
  [236, 238, 236], [76, 154, 236], [120, 124, 236], [176, 98, 236], [228, 84, 236],
  [236, 88, 180], [236, 106, 100], [212, 136, 32], [160, 170, 0], [116, 196, 0],
  [76, 208, 32], [56, 204, 108], [56, 180, 204],
  // 明度 4（最も明るい）
  [236, 238, 236], [168, 204, 236], [188, 188, 236], [212, 178, 236], [236, 174, 236],
  [236, 174, 212], [236, 180, 176], [228, 196, 144], [204, 210, 120], [180, 222, 120],
  [168, 226, 144], [152, 226, 180], [160, 214, 228],
  // 背景として使える 2 色
  [0, 0, 0], [255, 255, 255],
] as const;

if (MASTER_PALETTE_RGB.length !== MASTER_PALETTE_SIZE) {
  throw new Error(
    `マスターパレットの色数が ${MASTER_PALETTE_RGB.length}。${MASTER_PALETTE_SIZE} 色でなければならない`,
  );
}

/** シェーダの `uniform vec3 uPalette[54]` にそのまま渡せる 0..1 の並び */
export const MASTER_PALETTE_UNIFORM: Float32Array = (() => {
  const out = new Float32Array(MASTER_PALETTE_SIZE * 3);
  MASTER_PALETTE_RGB.forEach(([r, g, b], i) => {
    out[i * 3] = r / 255;
    out[i * 3 + 1] = g / 255;
    out[i * 3 + 2] = b / 255;
  });
  return out;
})();

/** CPU 側でも同じ量子化ができるようにしておく（ゴールデンテスト用、§7.1） */
export function nearestMasterIndex(r: number, g: number, b: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < MASTER_PALETTE_SIZE; i++) {
    const color = MASTER_PALETTE_RGB[i]!;
    const dr = r - color[0];
    const dg = g - color[1];
    const db = b - color[2];
    // 人間の感度に近づけるための重み。シェーダ側と同じ係数を使う
    const distance = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}
