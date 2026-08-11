const source = "#version 300 es\n/**\n * 背景（BG 面の一番奥）の頂点処理（KV-02）。\n *\n * 頂点バッファを持たず、`gl_VertexID` から画面を覆う三角形を 1 枚生成する。\n * ポストプロセスの `fullscreen.vert.glsl` と同じ手だが、こちらは**シーンの中で**\n * 他の何よりも先に描かれる。深度は書かないので、後から来る形が普通に上へ乗る。\n */\nprecision highp float;\n\nout vec2 vUv;\n\nvoid main() {\n  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n  vUv = p;\n  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n}\n";
export default source;

