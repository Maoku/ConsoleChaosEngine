/**
 * FC カラークラッシュ 第 1 パス（T0-10、候補 B。T2-10 でスプライト面を追加）。
 *
 * 出力は 16×16 ブロックごとに 1 テクセル。
 * **BG 面とスプライト面のぶんを上下に積む**（256×224 → 16×14 が 2 段で 16×28）。
 * 上段が BG（`uSource`）、下段がスプライト（`uSprite`）。
 *
 * 面を分けるのは実機と同じ理由による。BG は属性ブロックごとに色数が制限されるが、
 * OBJ は自分のパレットを持ち、背景に何が描かれていても影響を受けない。
 * 混ぜて数えると、草の上に立ったキャラクタの靴が緑に潰れる。
 *
 * 各フラグメントは自分のブロックの 256 テクセルを走査し、マスターパレットへ量子化した
 * うえで最頻の 3 色を選び、そのインデックスを R / G / B に詰めて返す（各 0..53）。
 *
 * 1 パス方式（候補 A）は「全画素 × 256 フェッチ」になるのに対し、
 * この方式は「ブロック数 × 256 フェッチ」で済む（256×224 で 875 分の 1）。
 */

const int PALETTE_SIZE = 54;
const int BLOCK = 16;

uniform vec3 uPalette[PALETTE_SIZE];
uniform vec2 uSceneSize;   // 元画像の画素数
uniform sampler2D uSprite; // スプライト面。α = 0 は「何も描かれていない」

// 重み付き距離で最も近いマスターパレットの番号を返す
int nearestIndex(vec3 c) {
  int best = 0;
  float bestDistance = 1e9;
  for (int i = 0; i < PALETTE_SIZE; i++) {
    vec3 d = c - uPalette[i];
    float distance = d.r * d.r * 0.299 + d.g * d.g * 0.587 + d.b * d.b * 0.114;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

void main() {
  ivec2 cell = ivec2(floor(vUv * uOutputSize));
  int rows = int(uOutputSize.y) / 2;
  bool spritePlane = cell.y >= rows;
  ivec2 origin = ivec2(cell.x, spritePlane ? cell.y - rows : cell.y) * BLOCK;

  float counts[PALETTE_SIZE];
  for (int i = 0; i < PALETTE_SIZE; i++) counts[i] = 0.0;

  for (int y = 0; y < BLOCK; y++) {
    for (int x = 0; x < BLOCK; x++) {
      ivec2 texel = origin + ivec2(x, y);
      if (spritePlane) {
        // 抜けている画素は数えない。数えると「透明」が最頻色になり、
        // 数ドットしかない靴やリボンの色が候補から落ちる
        vec4 c = texelFetch(uSprite, texel, 0);
        if (c.a < 0.5) continue;
        counts[nearestIndex(c.rgb)] += 1.0;
      } else {
        counts[nearestIndex(texelFetch(uSource, texel, 0).rgb)] += 1.0;
      }
    }
  }

  // 最頻の 3 色を選ぶ。選んだものは 0 にして次を探す（3 回なので素直に回す）
  ivec3 chosen = ivec3(0);
  for (int slot = 0; slot < 3; slot++) {
    int best = 0;
    float bestCount = -1.0;
    for (int i = 0; i < PALETTE_SIZE; i++) {
      if (counts[i] > bestCount) {
        bestCount = counts[i];
        best = i;
      }
    }
    counts[best] = -1.0;
    if (slot == 0) chosen.x = best;
    else if (slot == 1) chosen.y = best;
    else chosen.z = best;
  }

  fragColor = vec4(vec3(chosen) / 255.0, 1.0);
}
