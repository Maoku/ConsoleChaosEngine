#version 300 es
/**
 * スキニング + 世代ごとの頂点処理（T0-06 / T0-19）。
 *
 * ps1_vertex.glsl と同じ量子化・アフィン UV を行い、その前にスキニングを適用する。
 * フラグメントは ps1_forward.glsl を共用する。
 */
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aJoints;
layout(location = 4) in vec4 aWeights;

// 24 は gen3/gen4 のキャラクタが持つジョイント数（Docs/asset-rules.md §5）。
// mat4 24 本 = 96 vec4 で、GLES3 が保証する頂点ユニフォーム 256 vec4 に収まる
const int MAX_JOINTS = 24;
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
out vec3 vWorld;   // 松明（点光源）の距離を測るためのワールド座標（T2-04）

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
