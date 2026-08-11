#version 300 es
// T0-04 の受け入れ確認用。三角形を 1 枚描くだけの最小シェーダ。
precision highp float;

layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec3 aColor;

uniform vec2 uScale;

out vec3 vColor;

void main() {
  vColor = aColor;
  gl_Position = vec4(aPosition * uScale, 0.0, 1.0);
}
