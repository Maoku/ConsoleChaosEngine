/**
 * T0-10 / T0-13 の検証用シーン（フルスクリーン 1 パスで描く合成画像）。
 *
 * カラークラッシュの効きを見るために、意図的に
 *   - なめらかなグラデーション（帯状の潰れが出る）
 *   - 16×16 ブロックをまたぐ小さな色つき円（ブロック内の色数超過が出る）
 *   - 高彩度と低彩度の隣接
 * を含める。パズル F-1（色の潰れ）の題材そのもの。
 */

uniform float uSceneTime;

// 円を描く。中心・半径・色を与える
vec3 circle(vec3 base, vec2 uv, vec2 center, float radius, vec3 color) {
  float d = distance(uv * vec2(uOutputSize.x / uOutputSize.y, 1.0), center);
  return d < radius ? color : base;
}

void main() {
  vec2 uv = vUv;
  float aspect = uOutputSize.x / uOutputSize.y;

  // 斜めのグラデーション（量子化で帯が出る）
  vec3 color = mix(vec3(0.15, 0.2, 0.5), vec3(0.9, 0.75, 0.35), uv.x * 0.6 + uv.y * 0.4);

  // 上部に虹色の帯
  if (uv.y > 0.78) {
    float h = fract(uv.x * 3.0);
    color = clamp(abs(fract(h + vec3(0.0, 0.333, 0.667)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  }

  // 動く円を 4 つ。16 画素ブロックをまたいで色数を超過させる
  float t = uSceneTime;
  color = circle(color, uv, vec2(0.5 * aspect + sin(t) * 0.25, 0.45), 0.14, vec3(0.95, 0.15, 0.2));
  color = circle(color, uv, vec2(0.9 * aspect + sin(t * 1.3) * 0.2, 0.3), 0.10, vec3(0.1, 0.9, 0.35));
  color = circle(color, uv, vec2(0.4 * aspect + cos(t * 0.8) * 0.3, 0.62), 0.08, vec3(0.2, 0.4, 1.0));
  color = circle(color, uv, vec2(1.2 * aspect + cos(t * 1.1) * 0.15, 0.55), 0.06, vec3(1.0, 1.0, 1.0));

  fragColor = vec4(color, 1.0);
}
