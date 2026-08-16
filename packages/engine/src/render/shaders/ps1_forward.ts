const source = `#version 300 es
precision highp float;

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
uniform vec3 uLightDirection;
uniform vec3 uDirectionalColor;
uniform vec3 uAmbient;
uniform float uDiffuse;
uniform vec4 uPointLight;
uniform vec3 uPointLightColor;
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

  float lambert = max(dot(normal, normalize(uLightDirection)), 0.0);
  float pointFalloff = 0.0;
  if (uPointLight.w > 0.0) {
    float falloff = clamp(1.0 - distance(vWorld, uPointLight.xyz) / uPointLight.w, 0.0, 1.0);
    pointFalloff = falloff * falloff;
  }
  vec3 shade = min(
    uAmbient + uDirectionalColor * (uDiffuse * lambert) + uPointLightColor * pointFalloff,
    vec3(1.0)
  );
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

export default source;
