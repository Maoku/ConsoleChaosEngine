export const AFFINE_SURFACE_VERTEX = `#version 300 es
precision highp float;

void main() {
  vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const AFFINE_SURFACE_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uSource;
uniform vec2 uResolution;
uniform vec4 uScreenRect;
uniform vec2 uUvOrigin;
uniform vec2 uUvStepX;
uniform vec2 uUvStepY;
uniform bool uRepeat;

out vec4 fragColor;

void main() {
  vec2 screen = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 local = screen - uScreenRect.xy;
  if (local.x < 0.0 || local.y < 0.0 || local.x >= uScreenRect.z || local.y >= uScreenRect.w) discard;
  vec2 uv = uUvOrigin + uUvStepX * local.x + uUvStepY * local.y;
  uv = uRepeat ? fract(uv) : clamp(uv, 0.0, 1.0);
  fragColor = texture(uSource, uv);
}
`;
