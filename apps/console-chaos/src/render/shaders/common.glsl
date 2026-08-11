// フルスクリーンパスが共通で持つ宣言（postfx/chain.ts が各パスの先頭に連結する）。
// #version 行は chain.ts 側が付ける。ここには書かない。

precision highp float;
precision highp int;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSource;   // 直前のパスの出力
uniform vec2 uSourceSize;    // 入力の画素数
uniform vec2 uOutputSize;    // 出力の画素数
uniform float uTimeSeconds;  // ノイズなど時間依存の演出用

// 入力を素直に取得する
vec4 sampleSource(vec2 uv) {
  return texture(uSource, uv);
}

// テクセル中心へスナップする。ドット単位の見えを崩さないため、
// 拡大時のサンプリングは常にこれを通す。
vec2 snapToTexel(vec2 uv, vec2 size) {
  return (floor(uv * size) + 0.5) / size;
}

// 輝度（NTSC 系の重み）。カラークラッシュの代表色選定と CRT のにじみで使う。
float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}
