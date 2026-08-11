#version 300 es
/**
 * 背景（BG 面の一番奥）のフラグメント処理（KV-02、計画 §3 の決定 4）。
 *
 * 改訂前の背景は `pipeline.ts` の黒クリア 1 つだけで、空も遠景も存在しなかった。
 * 基準画の要求（F「どこにも黒が無い。どの領域も奥にまだ何かある」）はここで満たす。
 *
 * 中身は 3 つだけ。
 *   1. 縦のグラデーション（上端色 → 下端色。同じ値なら単色）
 *   2. 遠景の層
 *   3. 近景の層
 *
 * **層は 2 枚で固定する。** 多重スクロールを持つのは第2世代だけなので、
 * 枚数を可変にする仕組み（レイヤシステム）は作らない（GAME_PLAN §11.1.1）。
 *
 * 背景に陰影は掛けない。第1世代の白と生成りは、明るさを掛けると中間灰へ落ちて
 * 形が消えるため（KV-01 §2）。**平らな 1 枚だからこそ最上段の色を置ける。**
 */
precision highp float;

in vec2 vUv;   // 0..1。y = 0 が画面の下端

uniform vec3 uSkyTop;
uniform vec3 uSkyBottom;
uniform sampler2D uFar;
uniform sampler2D uNear;
// 層の置き場。x = 横の繰り返し数（0 以下なら層を持たない）、y = 横のずらし（UV）、
// z = 層の下端（画面の下から測った比）、w = 層の高さ（画面比）
uniform vec4 uFarRect;
uniform vec4 uNearRect;
// 背景に掛ける明るさ（BR-03）。空の見えない部屋にいる間だけ 0 へ向かう。
// **暗さは世代ではなく場所が決める**ので、ここに世代の分岐は無い（不変条件 I2）
uniform float uBrightness;

out vec4 fragColor;

vec3 overlay(vec3 under, sampler2D map, vec4 rect) {
  if (rect.x <= 0.0) return under;
  float v = (vUv.y - rect.z) / rect.w;
  if (v < 0.0 || v > 1.0) return under;
  // 横は繰り返して敷き、縦は層の帯にちょうど 1 枚を収める。
  // 絵は上下を入れ替えて読み込んである（`renderer3d` の `flipY`）ので、v はそのまま渡す
  vec4 c = texture(map, vec2(vUv.x * rect.x + rect.y, v));
  return mix(under, c.rgb, c.a);
}

void main() {
  vec3 color = mix(uSkyBottom, uSkyTop, vUv.y);
  color = overlay(color, uFar, uFarRect);
  color = overlay(color, uNear, uNearRect);
  // 空の見えない部屋（P2-1）。層まで含めて落とすので、地平のシルエットも残らない
  color *= uBrightness;
  fragColor = vec4(color, 1.0);
}
