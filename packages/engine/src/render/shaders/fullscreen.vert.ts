const source = "#version 300 es\n// フルスクリーンパス共通の頂点シェーダ。\n// 頂点バッファを持たず、gl_VertexID から画面を覆う三角形を 1 枚生成する\n// （四角形 2 枚より対角線上のピクセル分割が起きない）。\nprecision highp float;\n\nout vec2 vUv;\n\nvoid main() {\n  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n  vUv = p;\n  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n}\n";
export default source;

