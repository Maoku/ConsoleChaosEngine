export const DEFAULT_MAX_JOINTS_PER_SKIN = 24;

export function createSkinnedVertexShader(maxJoints = DEFAULT_MAX_JOINTS_PER_SKIN): string {
  if (!Number.isInteger(maxJoints) || maxJoints < 1) {
    throw new RangeError(`maxJoints must be a positive integer; received ${maxJoints}`);
  }
  return `#version 300 es
/**
 * スキニング + 世代ごとの頂点処理（T0-06 / T0-19）。
 * ジョイント上限はレンダラー作成時にアセット要件とGPU上限に合わせて注入する。
 */
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aJoints;
layout(location = 4) in vec4 aWeights;

const int MAX_JOINTS = ${maxJoints};
uniform mat4 uJoints[MAX_JOINTS];
uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform vec2 uResolution;
uniform float uQuantizeStep;

out vec2 vUvW;
out vec2 vUvCorrect;
out float vW;
out vec3 vNormal;
out float vDepth;
out vec3 vWorld;

void main() {
  mat4 skin =
      aWeights.x * uJoints[int(aJoints.x)] +
      aWeights.y * uJoints[int(aJoints.y)] +
      aWeights.z * uJoints[int(aJoints.z)] +
      aWeights.w * uJoints[int(aJoints.w)];

  vec4 world = uModel * (skin * vec4(aPosition, 1.0));
  vec4 clip = uViewProjection * world;

  if (uQuantizeStep > 0.0) {
    vec3 ndc = clip.xyz / clip.w;
    vec2 grid = max(uResolution / uQuantizeStep, vec2(1.0));
    ndc.xy = floor(ndc.xy * grid + 0.5) / grid;
    clip = vec4(ndc * clip.w, clip.w);
  }

  vWorld = world.xyz;
  vNormal = mat3(uModel) * (mat3(skin) * aNormal);
  vW = clip.w;
  vUvW = aUv * clip.w;
  vUvCorrect = aUv;
  vDepth = clip.w;
  gl_Position = clip;
}
`;
}

export default createSkinnedVertexShader();
