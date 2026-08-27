export const DEFAULT_SHADER_DIRECTIONAL_LIGHTS = 4;
export const DEFAULT_SHADER_POINT_LIGHTS = 4;

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer; received ${value}`);
  return value;
}

export function createForwardFragmentShader(
  maxDirectionalLights = DEFAULT_SHADER_DIRECTIONAL_LIGHTS,
  maxPointLights = DEFAULT_SHADER_POINT_LIGHTS,
): string {
  const directionalCount = positiveInteger(maxDirectionalLights, 'maxDirectionalLights');
  const pointCount = positiveInteger(maxPointLights, 'maxPointLights');
  return `#version 300 es
precision highp float;

const int MAX_DIRECTIONAL_LIGHTS = ${directionalCount};
const int MAX_POINT_LIGHTS = ${pointCount};

in vec2 vUvW;
in vec2 vUvCorrect;
in float vW;
in vec3 vNormal;
in float vDepth;
in vec3 vWorld;

uniform sampler2D uBaseColor;
uniform sampler2D uTopColor;
uniform sampler2D uTweenColor;
uniform sampler2D uEnvironment;
uniform vec4 uBaseColorFactor;
uniform float uTextureMix;
uniform float uAffineAmount;
uniform int uDirectionalLightCount;
uniform vec3 uLightDirections[MAX_DIRECTIONAL_LIGHTS];
uniform vec3 uDirectionalLightColors[MAX_DIRECTIONAL_LIGHTS];
uniform vec3 uAmbient;
uniform float uDiffuse;
uniform int uPointLightCount;
uniform vec4 uPointLights[MAX_POINT_LIGHTS];
uniform vec3 uPointLightColors[MAX_POINT_LIGHTS];
uniform vec3 uCameraPosition;
uniform float uEnvironmentStrength;
uniform float uAlphaCutoff;
uniform vec4 uFog;
uniform vec4 uBlendColorOverride;
uniform vec2 uBlendControl;

out vec4 fragColor;

const float PI = 3.141592653589793;

vec2 equirectangularUv(vec3 direction) {
  vec3 unitDirection = normalize(direction);
  float u = fract(0.5 + atan(unitDirection.z, unitDirection.x) / (2.0 * PI));
  float v = acos(clamp(unitDirection.y, -1.0, 1.0)) / PI;
  return vec2(u, v);
}

vec4 mixPremultipliedAlpha(vec4 from, vec4 to, float amount) {
  float alpha = mix(from.a, to.a, amount);
  vec3 premultiplied = mix(from.rgb * from.a, to.rgb * to.a, amount);
  vec3 color = alpha > 0.00001 ? premultiplied / alpha : vec3(0.0);
  return vec4(color, alpha);
}

void main() {
  vec2 affineUv = vUvW / vW;
  vec2 uv = mix(vUvCorrect, affineUv, uAffineAmount);
  vec3 normal = normalize(vNormal);
  vec4 primary = normal.y > 0.5 ? texture(uTopColor, uv) : texture(uBaseColor, uv);
  vec4 base = mixPremultipliedAlpha(
    primary,
    texture(uTweenColor, uv),
    clamp(uTextureMix, 0.0, 1.0)
  ) * uBaseColorFactor;
  if (base.a < uAlphaCutoff) discard;

  vec3 shade = uAmbient;
  for (int i = 0; i < MAX_DIRECTIONAL_LIGHTS; i++) {
    if (i >= uDirectionalLightCount) break;
    float lambert = max(dot(normal, normalize(uLightDirections[i])), 0.0);
    shade += uDirectionalLightColors[i] * (uDiffuse * lambert);
  }
  for (int i = 0; i < MAX_POINT_LIGHTS; i++) {
    if (i >= uPointLightCount) break;
    vec4 point = uPointLights[i];
    if (point.w <= 0.0) continue;
    float falloff = clamp(1.0 - distance(vWorld, point.xyz) / point.w, 0.0, 1.0);
    shade += uPointLightColors[i] * falloff * falloff;
  }
  shade = min(shade, vec3(1.0));
  vec3 color = base.rgb * shade;

  if (uEnvironmentStrength > 0.0) {
    vec3 incident = normalize(vWorld - uCameraPosition);
    vec3 reflection = reflect(incident, normal);
    vec3 environment = texture(uEnvironment, equirectangularUv(reflection)).rgb;
    vec3 reflectedColor = min(color * 0.55 + environment * 0.65, vec3(1.0));
    color = mix(color, reflectedColor, clamp(uEnvironmentStrength, 0.0, 1.0));
  }

  if (uFog.w > 0.0) {
    color = mix(color, uFog.rgb, clamp(1.0 - exp(-vDepth * uFog.w), 0.0, 1.0));
  }
  color = mix(color, uBlendColorOverride.rgb, uBlendColorOverride.a);
  float blendAlpha = base.a * uBlendControl.y;
  color *= mix(1.0, blendAlpha, uBlendControl.x);
  fragColor = vec4(color, blendAlpha);
}
`;
}

export default createForwardFragmentShader();
