#version 300 es
precision highp float;

in vec3 vNormal;
in vec2 vUv;
out vec4 fragColor;

uniform vec4 uBaseColor;

void main() {
  float light = 0.4 + 0.6 * max(dot(normalize(vNormal), normalize(vec3(0.3, 0.6, 1.0))), 0.0);
  fragColor = vec4(uBaseColor.rgb * light, uBaseColor.a);
}
