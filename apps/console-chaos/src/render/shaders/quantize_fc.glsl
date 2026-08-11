/**
 * FC カラークラッシュ 第 2 パス（T0-10、候補 B。T2-10 でスプライト面を追加）。
 *
 * 第 1 パスが作った 2 段のブロックパレット（上段 BG / 下段スプライト）を参照し、
 * 各画素を「その面・そのブロックで使える色」のいずれかに丸めたうえで、
 * スプライト面を背景の上に重ねる。
 *
 * これがパズル F-1（色の潰れ）の土台になる：16×16 ブロックの中に 4 色を超える色を
 * 持ち込むと、色が潰れて情報が失われる。
 *
 * **面ごとに候補が違う。**
 *   BG        … ブロックの 3 色 + 画面共通の背景色（実機の「背景色」）
 *   スプライト … ブロックの 3 色のみ。残る 1 色は抜き（透明）なので候補に入らない
 * これにより、背景の色数がキャラクタの色を食うことがなくなる。
 */

const int PALETTE_SIZE = 54;

uniform vec3 uPalette[PALETTE_SIZE];
uniform sampler2D uScene;       // 背景（BG 面）
uniform sampler2D uSprite;      // スプライト面。α = 0 は「何も描かれていない」
uniform vec2 uSceneSize;
uniform int uBackgroundIndex;   // 画面共通の背景色（実機の「背景色」に相当）
uniform float uAmount;          // 0 = 素通し、1 = 完全なカラークラッシュ（比較・配慮設定用）

float weightedDistance(vec3 a, vec3 b) {
  vec3 d = a - b;
  return d.r * d.r * 0.299 + d.g * d.g * 0.587 + d.b * d.b * 0.114;
}

void main() {
  vec4 sprite = texture(uSprite, vUv);
  bool onSprite = sprite.a >= 0.5;
  vec3 source = onSprite ? sprite.rgb : texture(uScene, vUv).rgb;

  // ブロックパレットは 2 段重ね。下段がスプライト面ぶん
  vec2 paletteUv = vec2(vUv.x, vUv.y * 0.5 + (onSprite ? 0.5 : 0.0));
  vec3 packed = texture(uSource, paletteUv).rgb * 255.0;
  int i0 = int(packed.r + 0.5);
  int i1 = int(packed.g + 0.5);
  int i2 = int(packed.b + 0.5);

  vec3 candidates[4];
  candidates[0] = uPalette[i0];
  candidates[1] = uPalette[i1];
  candidates[2] = uPalette[i2];
  // BG だけが画面共通の背景色を持つ。スプライトは 3 色 + 抜きなので、
  // 4 つ目にも自分の色を入れて候補を実質 3 色に保つ
  candidates[3] = onSprite ? uPalette[i0] : uPalette[uBackgroundIndex];

  vec3 best = candidates[0];
  float bestDistance = 1e9;
  for (int i = 0; i < 4; i++) {
    float d = weightedDistance(source, candidates[i]);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidates[i];
    }
  }

  fragColor = vec4(mix(source, best, uAmount), 1.0);
}
