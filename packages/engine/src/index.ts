export const ENGINE_VERSION = '0.2.0';

export * from './assets/manager';
export {
  GltfSubsetError,
  browserIO,
  computeGlobalMatrices,
  computeJointMatrices,
  createPose,
  loadGltf,
  parseGlb,
  parseGltf,
  resetPose,
  sampleAnimation,
  type AnimationPath,
  type GltfAnimation,
  type GltfAnimationChannel,
  type GltfIO,
  type GltfImage,
  type GltfMaterial,
  type GltfMesh,
  type GltfModel,
  type GltfNode,
  type GltfPrimitive,
  type GltfSkin,
  type Pose,
  type Vec3 as GltfVec3,
  type Vec4 as GltfVec4,
} from './assets/gltf';
export * from './audio/service';
export * from './audio/score';
export * from './audio/clock';
export * from './audio/voicelimit';
export * from './audio/engine';
export * from './audio/synth-fc';
export * from './audio/sampler-sfc';
export * from './audio/adpcm-ps1';
export * from './audio/stream-ps2';
export * from './core/events';
export * from './core/component';
export * from './core/query';
export * from './core/rng';
export * from './core/time';
export * from './core/world';
export * from './core/system';
export * from './debug/stats';
export * from './generation/controller';
export * from './generation/profiles';
export * from './input/actions';
export * from './input/device';
export * from './physics/aabb';
export * from './platform/web';
export * from './render/frame';
export * from './render/blend';
export * from './render/billboard';
export * from './render/ordering-table';
export * from './render/affine/reference';
export * from './render/environment/mapping';
export * from './render/raster/validate';
export * from './render/lighting';
export * from './render/renderer';
export * from './render/webgl-renderer';
export * from './render/generation-pipeline';
export * from './render/postfx/presets';
export * from './render/postfx/chain';
export * from './render/quantize/palette-fc';
export * from './render/quantize/palette-sfc';
export * from './render/sort';
export * from './render/sprite-limit';
export * from './render/master-palette';
export * from './render/gl/index';
export { createCamera, type Camera, type CameraProjection } from './render/camera';
export {
  DEFAULT_DENSITY,
  DEFAULT_MAX_SEGMENTS,
  billboardMesh,
  boxMesh,
  quadMesh,
  segmentsFor,
  triangleCountOf,
  unitCube,
  type BoxMesh,
  type BoxOptions,
  type UvRect,
  type Vec3 as GeometryVec3,
} from './render/geometry';
export * from './runtime/game-host';
export * from './scene/schema';
