export const RASTER_SURFACE_VERTEX = `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const RASTER_SURFACE_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uSource;
uniform sampler2D uScanlines;
uniform vec2 uResolution;
uniform vec4 uScreenRect;

out vec4 fragColor;

void main() {
  vec2 screen = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 local = screen - uScreenRect.xy;
  if (local.x < 0.0 || local.y < 0.0 || local.x >= uScreenRect.z || local.y >= uScreenRect.w) discard;
  float row = (floor(local.y) + 0.5) / uScreenRect.w;
  vec4 scanline = texture(uScanlines, vec2(0.5, row));
  float horizontal = local.x / uScreenRect.z;
  vec2 uv = vec2(scanline.r + (horizontal - 0.5) * scanline.g, scanline.b);
  vec4 source = texture(uSource, uv);
  fragColor = vec4(source.rgb * scanline.a, source.a);
}
`;
