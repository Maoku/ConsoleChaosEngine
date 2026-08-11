#version 300 es
/**
 * 背景（BG 面の一番奥）の頂点処理（KV-02）。
 *
 * 頂点バッファを持たず、`gl_VertexID` から画面を覆う三角形を 1 枚生成する。
 * ポストプロセスの `fullscreen.vert.glsl` と同じ手だが、こちらは**シーンの中で**
 * 他の何よりも先に描かれる。深度は書かないので、後から来る形が普通に上へ乗る。
 */
precision highp float;

out vec2 vUv;

void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
