#version 300 es
/**
 * 第3世代（PS1）の頂点処理：頂点座標の量子化 + アフィン UV（T0-08、V1 / V2）。
 *
 * 実機の見えを作る 2 つの要因を、パラメータで強さを変えられる形で再現する。
 *
 * 1. 頂点の揺れ … 変換後の座標を整数精度に丸めていたため、頂点が画素格子へ吸着し、
 *    カメラやモデルが動くと小刻みに跳ねる。ここでは NDC を「内部解像度 / 量子化粒度」の
 *    格子へ丸めることで再現する。uQuantizeStep = 0 で無効（比較用）。
 *
 * 2. テクスチャの歪み … 遠近補正を行わず、UV をスクリーン空間で線形補間していた。
 *    GLSL ES 3.0 には noperspective 修飾子が無いため、
 *    varying に uv * w と w を渡し、フラグメント側で割り戻して実現する。
 *      I(uv*w) / I(w) = Σλ·uv   （I は遠近補正つき補間、λ はスクリーン空間の重心座標）
 *    uAffineAmount で 0（遠近補正あり）から 1（完全なアフィン）まで混ぜられる。
 */
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;

uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform vec2 uResolution;      // 内部解像度（画素）
uniform float uQuantizeStep;   // 0 = 量子化なし。1 = 1 画素格子。大きいほど粗い
/**
 * UV を送る量（SG-08）。滝が落ち続けて見えるのはこれだけによる。
 *
 * **フラグメント側でずらしてはいけない。** アフィン UV は `uv * w` を補間してから
 * `w` で割り戻す仕掛けなので、割り戻した後にずらすと第3世代の歪みまで動いてしまう。
 * ここで加えれば、送った後の UV がそのまま補間に乗る
 */
uniform vec2 uUvScroll;
// アフィンの強さ（uAffineAmount）は ps1_forward.glsl 側で混ぜる

out vec2 vUvW;      // uv * w（アフィン成分）
out vec2 vUvCorrect; // 遠近補正ありの uv
out float vW;
out vec3 vNormal;
out float vDepth;
out vec3 vWorld;   // 松明（点光源）の距離を測るためのワールド座標（T2-04）

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vec4 clip = uViewProjection * world;

  if (uQuantizeStep > 0.0) {
    // NDC へ落として画素格子に吸着させ、同じ w を掛けてクリップ空間へ戻す。
    // w を保つことで、遠近そのものは壊さずに「頂点の跳ね」だけを出す。
    vec3 ndc = clip.xyz / clip.w;
    vec2 grid = max(uResolution / uQuantizeStep, vec2(1.0));
    ndc.xy = floor(ndc.xy * grid + 0.5) / grid;
    clip = vec4(ndc * clip.w, clip.w);
  }

  vec2 uv = aUv + uUvScroll;

  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vW = clip.w;
  vUvW = uv * clip.w;
  vUvCorrect = uv;
  vDepth = clip.w;
  gl_Position = clip;
}
