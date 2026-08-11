/**
 * CRT パス（T0-11、§5.4.5、GAME_PLAN §8）。
 *
 * **1 本のシェーダ + パラメータ違いで 4 世代すべてを表現する**（§11.1.1 V6）。
 * 世代ごとの分岐はシェーダ内に書かない。値はすべて uniform で受ける。
 *
 * 品質設定は分岐ではなく**プリプロセッサによるバリアント**で切り替える。
 * 低スペック機で「使わない機能の分岐コスト」を払わないため（§5.4.5）。
 *
 *   CRT_FULL   … 全機能（歪み・にじみ・ブルーム・マスク・ノイズ・ビネット）
 *   （未定義）  … Light。走査線とビネットのみ
 */

uniform float uScanline;    // 走査線の強さ 0..1
uniform float uBleed;       // 色のにじみ（横方向）0..1
uniform float uCurvature;   // 画面の歪み 0..1
uniform float uBloom;       // 明部のにじみ出し 0..1
uniform float uVignette;    // 周辺減光 0..1
uniform float uNoise;       // ざらつき 0..1
uniform float uMask;        // 蛍光体マスクの強さ 0..1
uniform vec2 uContentSize;  // 入力（世代の内部解像度）

// 画面の緩やかな樽型歪み
vec2 curve(vec2 uv, float amount) {
  vec2 centered = uv * 2.0 - 1.0;
  float r2 = dot(centered, centered);
  centered *= 1.0 + amount * 0.12 * r2;
  return centered * 0.5 + 0.5;
}

// 決定的な擬似乱数（時間を混ぜてざらつきを出す）
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;

#ifdef CRT_FULL
  uv = curve(uv, uCurvature);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
#endif

  vec3 color = sampleSource(uv).rgb;

#ifdef CRT_FULL
  // 横方向のにじみ。RF ほど強く、コンポーネントではほぼ効かない。
  // 実機の映像信号は輝度と色差の帯域が違ったため、色だけが横に流れた。
  float texel = 1.0 / uContentSize.x;
  vec3 left = sampleSource(uv - vec2(texel * 1.5, 0.0)).rgb;
  vec3 right = sampleSource(uv + vec2(texel * 1.5, 0.0)).rgb;
  vec3 blurred = (left + right + color * 2.0) * 0.25;
  // 輝度は保ち、色成分だけを混ぜる
  float lumaSharp = luma(color);
  color = mix(color, blurred + (lumaSharp - luma(blurred)), uBleed);

  // 明部のにじみ出し
  float bright = max(luma(color) - 0.6, 0.0);
  color += bright * uBloom;

  // 蛍光体マスク（画素の縦 3 分割）
  float maskPhase = mod(gl_FragCoord.x, 3.0);
  vec3 mask = vec3(
    maskPhase < 1.0 ? 1.0 : 0.85,
    maskPhase >= 1.0 && maskPhase < 2.0 ? 1.0 : 0.85,
    maskPhase >= 2.0 ? 1.0 : 0.85);
  color *= mix(vec3(1.0), mask, uMask);

  // ざらつき
  float grain = hash(gl_FragCoord.xy + fract(uTimeSeconds) * 100.0) - 0.5;
  color += grain * uNoise;
#endif

  // 走査線（Light でも効かせる。CRT らしさの主要因）。
  //
  // **1 本の太さを出力画素の整数倍に固定する**（BR-05）。内部解像度で本数を数えると、
  // たとえば 224 本を 720 画素へ敷くことになって 1 本 3.21 画素になり、
  // 本ごとに太さが揺れる＝画面全体にうなり（モアレ）が出る。
  // 丸めておけばどの本も同じ太さになり、うなりが消える。切替とは独立に常に効かせる
  float thickness = max(floor(uOutputSize.y / uContentSize.y + 0.5), 1.0);
  float line = mod(floor(gl_FragCoord.y / thickness), 2.0);
  color *= mix(1.0, 1.0 - uScanline, line);

  // 周辺減光
  vec2 fromCenter = uv - 0.5;
  float falloff = 1.0 - dot(fromCenter, fromCenter) * uVignette * 1.6;
  color *= clamp(falloff, 0.0, 1.0);

  fragColor = vec4(color, 1.0);
}
