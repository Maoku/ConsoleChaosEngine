#version 300 es
/**
 * 第3世代（PS1）のフラグメント処理（T0-08、V2）。
 *
 * - アフィン UV：頂点シェーダから渡された uv*w と w を割り戻す
 * - 頂点カラー相当のライティングは頂点単位に近い粗さで十分なので簡素に保つ
 * - テクスチャは nearest。深度テストは使わない（描画順で解決する。§5.4.2）
 */
precision highp float;

in vec2 vUvW;
in vec2 vUvCorrect;
in float vW;
in vec3 vNormal;
in float vDepth;
in vec3 vWorld;

uniform sampler2D uBaseColor;
/**
 * 天面（上を向いた面）に貼る 2 枚目の絵（SG-04）。
 * 基準画の足場は天面が草・側面が砂岩で、1 枚では出せない。
 *
 * **2 枚目を持たない材質には 1 枚目と同じ絵が束ねられている。**
 * 束ねないと GL が「直前に誰かがそのユニットへ束ねた絵」を拾う
 */
uniform sampler2D uTopColor;
uniform vec4 uBaseColorFactor;
uniform float uAffineAmount;   // 0 = 遠近補正、1 = 完全なアフィン
uniform vec3 uLightDirection;
/**
 * 陰影の内訳（T2-04 → SG-09）。材質ごとに変わる。
 * 既定は 0.45 / 0.55 で、暗室（P2-1）だけが 0.05 / 0.0 になる。
 *
 * **SG-09 で環境光が色を持った**（vec3）。渡ってくるのは
 * `material.ambient × 空の下端色 ÷ その明度` で、明度で正規化してあるので
 * 「陰影の取り分」の意味は変わらない。変わるのは影側の色相だけである
 *（太陽が高い昼は、影が空の色に沈む。基準画の J）。
 * 陰影を受けない板（落ち影・スプライト）には [1,1,1] が来る
 */
uniform vec3 uAmbient;
uniform float uDiffuse;
// 松明（点光源）。xyz = ワールド位置、w = 届く半径。**w = 0 なら松明そのものが無い**。
// 動的ライティングを持つ世代でだけ w > 0 になる
uniform vec4 uTorch;
// アルファ抜きのしきい値（T1-23）。0 で無効。
// ツタや敵は「交差する 2 枚の板 + 抜き」で形を出す。実機の草木・スプライトと同じ作り方で、
// 半透明合成を持たない世代でも成立する（第1世代でも抜きは使えた）
uniform float uAlphaCutoff;
/**
 * 遠景を背景色へ溶かす（KV-06）。xyz = 溶け込む色（**背景の下端色そのもの**）、
 * w = 1m あたりの濃さ。**w = 0 なら霧そのものが無い**。
 *
 * これは画素ごとの色の混ぜであって、描画順にはまったく触れない。
 * 深度バッファを持たない世代（第3世代）でも、三角形ソートの結果を壊さない。
 */
uniform vec4 uFog;

out vec4 fragColor;

void main() {
  vec2 affineUv = vUvW / vW;
  vec2 uv = mix(vUvCorrect, affineUv, uAffineAmount);

  // 上を向いた面だけ 2 枚目へ切り替える。0.5 は「箱の天面」と「側面」を分ける境で、
  // 斜めの面を持たない箱では実質 1 か 0 になる。ドローコールは増えない
  vec3 normal = normalize(vNormal);
  vec4 base = (normal.y > 0.5 ? texture(uTopColor, uv) : texture(uBaseColor, uv)) * uBaseColorFactor;
  if (base.a < uAlphaCutoff) discard;
  float lambert = max(dot(normal, normalize(uLightDirection)), 0.0);

  // 松明。距離で二乗に落ちる。半径の外は完全に 0（暗室では文字どおり何も見えない）
  float torch = 0.0;
  if (uTorch.w > 0.0) {
    float falloff = clamp(1.0 - distance(vWorld, uTorch.xyz) / uTorch.w, 0.0, 1.0);
    torch = falloff * falloff;
  }

  // 拡散光と松明は白いまま（光源の色は 1 つに保つ）。色を持つのは環境光だけ
  vec3 shade = min(uAmbient + vec3(uDiffuse * lambert + torch), vec3(1.0));
  vec3 color = base.rgb * shade;

  // 霧。カメラからの距離（vDepth = クリップ空間の w）で指数的に濃くなる
  if (uFog.w > 0.0) {
    color = mix(color, uFog.rgb, clamp(1.0 - exp(-vDepth * uFog.w), 0.0, 1.0));
  }

  fragColor = vec4(color, base.a);
}
