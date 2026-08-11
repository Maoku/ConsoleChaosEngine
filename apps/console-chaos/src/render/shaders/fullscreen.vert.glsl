#version 300 es
// フルスクリーンパス共通の頂点シェーダ。
// 頂点バッファを持たず、gl_VertexID から画面を覆う三角形を 1 枚生成する
// （四角形 2 枚より対角線上のピクセル分割が起きない）。
precision highp float;

out vec2 vUv;

void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
