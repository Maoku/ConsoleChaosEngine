import { mat4, vec3 } from 'gl-matrix';
import type { AssetHandle, AssetManager } from '../assets/manager';
import {
  computeGlobalMatrices,
  computeJointMatrices,
  createPose,
  sampleAnimation,
  type GltfModel,
  type GltfPrimitive,
} from '../assets/gltf';
import type { GenerationController } from '../generation/controller';
import type { GenerationId, HardwareGenerationProfile } from '../generation/profiles';
import { createCamera } from './camera';
import { createAffineSurfacePass } from './affine/pass';
import type {
  BackgroundCommand,
  GeometryCommand,
  MaterialCommand,
  MeshCommand,
  RenderFrame,
  SkinnedMeshCommand,
  SpriteCommand,
  Vec3,
} from './frame';
import { billboardMesh, boxMesh, quadMesh } from './geometry';
import {
  createBuffer,
  createGLContext,
  createProgram,
  createStateCache,
  createTexture,
  createVertexArray,
  orientImageBitmap,
  unsealShaderCompilation,
  type GLBuffer,
  type GLContext,
  type Program,
  type StateCache,
  type Texture,
  type TextureFilter,
  type TextureWrap,
  type VertexArray,
} from './gl/index';
import { createGenerationPipeline } from './generation-pipeline';
import { nearestMasterIndex } from './master-palette';
import { resolveFrameLighting } from './lighting';
import type { CrtPreset, CrtQuality } from './postfx/presets';
import ps1Fragment from './shaders/ps1_forward';
import ps1Vertex from './shaders/ps1_vertex';
import skinnedVertex from './shaders/skinned_test.vert';
import backdropFragment from './shaders/backdrop.frag';
import backdropVertex from './shaders/backdrop.vert';
import { createSortWorkspace, sortTrianglesByDepth, type TriangleSortWorkspace } from './sort';
import { createRasterSurfacePass } from './raster/pass';
import type { FrameRenderer } from './renderer';

const WHITE_AMBIENT: [number, number, number] = [1, 1, 1];
const WHITE_LIGHT: [number, number, number] = [1, 1, 1];
const NO_POINT_LIGHT: [number, number, number, number] = [0, 0, 0, 0];
const NO_FOG: [number, number, number, number] = [0, 0, 0, 0];
const NO_UV_SCROLL: [number, number] = [0, 0];
const NO_LAYER: [number, number, number, number] = [0, 0, 0, 0];
const SHADOW_STRENGTH = 0.72;
const FLOAT_RATE = 1;

export interface RenderTextureAsset {
  url: string;
  flipY?: boolean;
  wrap?: TextureWrap;
}

export interface RenderModelAsset {
  url: string;
  polygonSort?: boolean;
}

export interface RenderAtlasAsset {
  url: string;
  columns: number;
  rows: number;
}

export interface RenderAssetManifest {
  textures: readonly RenderTextureAsset[];
  models: readonly RenderModelAsset[];
  atlases: readonly RenderAtlasAsset[];
  geometries: readonly GeometryCommand[];
  fallbackTextures: Readonly<Record<GenerationId, string>>;
}

export interface GenerationWebGlRendererOptions {
  assets: AssetManager;
  manifest: RenderAssetManifest;
  quality?: () => CrtQuality;
  glitchAmount?: () => number;
  motionAmount?: () => number;
  crtOverride?: () => Partial<CrtPreset>;
  transitionColors?: {
    core: readonly [number, number, number];
    lead: readonly [number, number, number];
    trail: readonly [number, number, number];
  };
}

export interface GenerationWebGlRendererStats {
  readonly allocatedTargets: number;
  readonly renderedGenerations: number;
  readonly triangleCount: number;
}

interface Shape {
  vao: VertexArray;
  count: number;
  triangles: number;
  mode?: 'triangles' | 'lines';
  local?: { matrix: mat4; inverse: mat4 };
  sortable?: {
    positions: Float32Array;
    indices: Uint16Array;
    out: Uint16Array;
    workspace: TriangleSortWorkspace;
  };
}

interface Rig {
  model: GltfModel;
  parts: Shape[];
  colors: Array<readonly [number, number, number, number]>;
  maps: Texture[];
  pose: ReturnType<typeof createPose>;
  globals: Float32Array;
  joints: Float32Array;
  clips: string[];
}

interface AtlasGpu {
  texture: Texture;
  cells: Shape[];
}

interface CpuAssets {
  images: Map<string, ImageBitmap>;
  models: Map<string, GltfModel>;
  handles: Array<AssetHandle<unknown>>;
}

interface GpuBackend {
  render(frame: RenderFrame, generation: GenerationController): void;
  resize(): void;
  readonly renderedGenerations: number;
  readonly triangleCount: number;
  dispose(): void;
}

let rendererSequence = 0;

export function geometryCommandKey(geometry: GeometryCommand): string {
  switch (geometry.kind) {
    case 'box':
      return `box:${(geometry.halfExtents ?? [0.5, 0.5, 0.5]).join(',')}:${geometry.uvScale ?? 0}`;
    case 'quad':
      return `quad:${geometry.uvRepeat?.join(',') ?? '1,1'}`;
    case 'circle':
      return `circle:${geometry.radius}`;
    case 'polygon':
      return `polygon:${geometry.points.flat().join(',')}`;
    case 'polyline':
      return `polyline:${geometry.points.flat().join(',')}:${geometry.width}:${geometry.closed ?? false}`;
  }
}

function applies(command: { generations?: readonly GenerationId[] }, id: GenerationId): boolean {
  return command.generations === undefined || command.generations.includes(id);
}

function colorFactor(color: string | undefined): [number, number, number, number] {
  if (!color) return [1, 1, 1, 1];
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (hex) {
    return [
      Number.parseInt(hex[1]!, 16) / 255,
      Number.parseInt(hex[2]!, 16) / 255,
      Number.parseInt(hex[3]!, 16) / 255,
      1,
    ];
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\)$/i.exec(color);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, 1];
  return [1, 1, 1, 1];
}

function luma(color: readonly number[]): number {
  return 0.299 * color[0]! + 0.587 * color[1]! + 0.114 * color[2]!;
}

function resolveRelative(base: string, relative: string): string {
  if (/^(?:data:|https?:|\/)/.test(relative)) return relative;
  const slash = base.lastIndexOf('/');
  return slash < 0 ? relative : `${base.slice(0, slash + 1)}${relative}`;
}

async function loadCpuAssets(manager: AssetManager, manifest: RenderAssetManifest): Promise<CpuAssets> {
  const handles: Array<AssetHandle<unknown>> = [];
  const images = new Map<string, ImageBitmap>();
  const models = new Map<string, GltfModel>();
  const textureUrls = new Set([
    ...manifest.textures.map((asset) => asset.url),
    ...manifest.atlases.map((asset) => asset.url),
  ]);
  const imageHandles = await Promise.all([...textureUrls].map((url) => manager.loadImage(url)));
  imageHandles.forEach((handle, index) => {
    const url = [...textureUrls][index]!;
    images.set(url, handle.value);
    handles.push(handle as AssetHandle<unknown>);
  });
  const modelHandles = await Promise.all(manifest.models.map((asset) => manager.loadGltf(asset.url)));
  modelHandles.forEach((handle, index) => {
    const url = manifest.models[index]!.url;
    models.set(url, handle.value);
    handles.push(handle as AssetHandle<unknown>);
  });
  return { images, models, handles };
}

async function createGpuBackend(
  canvas: HTMLCanvasElement,
  ctx: GLContext,
  cpu: CpuAssets,
  options: GenerationWebGlRendererOptions,
): Promise<GpuBackend> {
  unsealShaderCompilation();
  const { gl } = ctx;
  const disposables: Array<{ dispose(): void }> = [];
  const state: StateCache = createStateCache(ctx);
  const camera = createCamera('perspective');
  const modelMatrix = mat4.create();
  const spriteProjection = mat4.create();
  const partMatrix = mat4.create();
  const localCamera = new Float32Array(3);
  const materialById = new Map<string, MaterialCommand>();
  const textures = new Map<string, Texture>();

  const textureSettings = new Map(options.manifest.textures.map((asset) => [asset.url, asset]));
  for (const [url, image] of cpu.images) {
    const atlas = options.manifest.atlases.some((asset) => asset.url === url);
    const settings = textureSettings.get(url);
    const flipY = atlas ? false : (settings?.flipY ?? true);
    // UNPACK_FLIP_Y_WEBGL は ImageBitmap には適用されないため、upload 前に向きを確定する。
    // legacy renderer は HTMLImageElement を flipY upload していたので、ここを省くと
    // 背景とworld materialだけが上下反転し、atlas spriteとの向きが食い違う。
    const uploadImage = await orientImageBitmap(image, flipY);
    const texture = createTexture(ctx, {
      width: image.width,
      height: image.height,
      filter: 'nearest',
      wrap: atlas ? 'clamp' : (settings?.wrap ?? 'repeat'),
      data: uploadImage,
    });
    if (uploadImage !== image) uploadImage.close();
    textures.set(url, texture);
    disposables.push(texture);
  }

  const sceneProgram: Program = createProgram(ctx, 'command-scene', ps1Vertex, ps1Fragment);
  const skinProgram: Program = createProgram(ctx, 'command-skin', skinnedVertex, ps1Fragment);
  const backgroundProgram: Program = createProgram(ctx, 'command-background', backdropVertex, backdropFragment);
  const rasterSurfacePass = createRasterSurfacePass(ctx, state);
  const affineSurfacePass = createAffineSurfacePass(ctx, state);
  disposables.push(sceneProgram, skinProgram, backgroundProgram, rasterSurfacePass, affineSurfacePass);

  function buildInterleaved(vertices: Float32Array, indices: Uint16Array, mode: 'triangles' | 'lines' = 'triangles'): Shape {
    const vbo = createBuffer(ctx, 'vertex', vertices);
    const ibo = createBuffer(ctx, 'index', indices);
    const vao = createVertexArray(ctx, [
      { location: 0, size: 3, buffer: vbo, strideBytes: 32, offsetBytes: 0 },
      { location: 1, size: 3, buffer: vbo, strideBytes: 32, offsetBytes: 12 },
      { location: 2, size: 2, buffer: vbo, strideBytes: 32, offsetBytes: 24 },
    ], { buffer: ibo, type: 'ushort' });
    disposables.push(vbo, ibo, vao);
    return { vao, count: indices.length, triangles: mode === 'triangles' ? indices.length / 3 : 0, mode };
  }

  function buildPrimitive(primitive: GltfPrimitive, skinned: boolean, sortable: boolean): Shape {
    const vertexCount = primitive.positions.length / 3;
    const buffers: GLBuffer[] = [
      createBuffer(ctx, 'vertex', primitive.positions),
      createBuffer(ctx, 'vertex', primitive.normals ?? new Float32Array(vertexCount * 3)),
      createBuffer(ctx, 'vertex', primitive.uvs ?? new Float32Array(vertexCount * 2)),
    ];
    if (skinned) {
      buffers.push(
        createBuffer(ctx, 'vertex', new Float32Array(primitive.joints ?? new Uint16Array(vertexCount * 4))),
        createBuffer(ctx, 'vertex', primitive.weights ?? new Float32Array(vertexCount * 4)),
      );
    }
    const ibo = createBuffer(ctx, 'index', primitive.indices, sortable ? 'dynamic' : 'static');
    const sizes: Array<1 | 2 | 3 | 4> = [3, 3, 2, 4, 4];
    const vao = createVertexArray(
      ctx,
      buffers.map((buffer, index) => ({ location: index, size: sizes[index]!, buffer })),
      { buffer: ibo, type: primitive.indices instanceof Uint32Array ? 'uint' : 'ushort' },
    );
    disposables.push(...buffers, ibo, vao);
    const shape: Shape = { vao, count: primitive.indices.length, triangles: primitive.indices.length / 3 };
    if (sortable && primitive.indices instanceof Uint16Array) {
      shape.sortable = {
        positions: primitive.positions,
        indices: primitive.indices,
        out: new Uint16Array(primitive.indices.length),
        workspace: createSortWorkspace(primitive.indices.length / 3),
      };
    }
    return shape;
  }

  function buildModelParts(source: GltfModel, sortable: boolean): Shape[] {
    const globals = new Float32Array(source.nodes.length * 16);
    computeGlobalMatrices(source, createPose(source), globals);
    const identity = mat4.create();
    const parts: Shape[] = [];
    source.nodes.forEach((node, index) => {
      if (node.mesh === null) return;
      const matrix = mat4.clone(globals.subarray(index * 16, index * 16 + 16));
      for (const primitive of source.meshes[node.mesh]?.primitives ?? []) {
        const shape = buildPrimitive(primitive, false, sortable);
        if (!mat4.exactEquals(matrix, identity)) {
          shape.local = { matrix, inverse: mat4.invert(mat4.create(), matrix) ?? identity };
        }
        parts.push(shape);
      }
    });
    return parts;
  }

  const modelSpecs = new Map(options.manifest.models.map((asset) => [asset.url, asset]));
  const modelParts = new Map<string, Shape[]>();
  for (const [url, source] of cpu.models) {
    modelParts.set(url, buildModelParts(source, modelSpecs.get(url)?.polygonSort ?? false));
  }

  const geometries = new Map<string, Shape>();
  for (const geometry of options.manifest.geometries) {
    if (geometry.kind === 'box') {
      const mesh = boxMesh(geometry.halfExtents ?? [0.5, 0.5, 0.5], { uvScale: geometry.uvScale ?? 0 });
      geometries.set(geometryCommandKey(geometry), buildInterleaved(mesh.vertices, mesh.indices));
    } else if (geometry.kind === 'quad') {
      const repeat = geometry.uvRepeat?.[0] ?? 1;
      const mesh = quadMesh(repeat);
      geometries.set(geometryCommandKey(geometry), buildInterleaved(mesh.vertices, mesh.indices));
    }
  }
  const shadowMesh = (() => {
    const mesh = quadMesh();
    return buildInterleaved(mesh.vertices, mesh.indices);
  })();
  const wireframeMesh = (() => {
    const corners: Array<readonly [number, number, number]> = [
      [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5],
      [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
    ];
    const vertices = new Float32Array(corners.flatMap(([x, y, z]) => [x, y, z, 0, 1, 0, 0, 0]));
    const edges = new Uint16Array([
      0, 1, 1, 2, 2, 3, 3, 0,
      4, 5, 5, 6, 6, 7, 7, 4,
      0, 4, 1, 5, 2, 6, 3, 7,
    ]);
    return buildInterleaved(vertices, edges, 'lines');
  })();

  const atlases = new Map<string, AtlasGpu>();
  for (const atlas of options.manifest.atlases) {
    const cells: Shape[] = [];
    for (let cell = 0; cell < atlas.columns * atlas.rows; cell++) {
      const column = cell % atlas.columns;
      const row = Math.floor(cell / atlas.columns);
      const mesh = billboardMesh({
        u0: column / atlas.columns,
        v0: row / atlas.rows,
        u1: (column + 1) / atlas.columns,
        v1: (row + 1) / atlas.rows,
      });
      cells.push(buildInterleaved(mesh.vertices, mesh.indices));
    }
    atlases.set(atlas.url, { texture: textures.get(atlas.url)!, cells });
  }

  async function embeddedTextures(source: GltfModel, url: string): Promise<Array<Texture | null>> {
    return Promise.all(source.images.map(async (image) => {
      let bitmap: ImageBitmap | null = null;
      if (image.data) {
        bitmap = await createImageBitmap(new Blob([image.data as BlobPart], { type: image.mimeType }));
      } else if (image.uri) {
        const external = textures.get(resolveRelative(url, image.uri));
        return external ?? null;
      }
      if (!bitmap) return null;
      const texture = createTexture(ctx, { width: bitmap.width, height: bitmap.height, filter: 'nearest', data: bitmap });
      bitmap.close();
      disposables.push(texture);
      return texture;
    }));
  }

  const rigs = new Map<string, Rig>();
  for (const [url, source] of cpu.models) {
    if (source.skins.length === 0) continue;
    const embedded = await embeddedTextures(source, url);
    const primitives = source.meshes.flatMap((mesh) => mesh.primitives);
    const fallback = textures.get(options.manifest.fallbackTextures.FC)!;
    rigs.set(url, {
      model: source,
      parts: primitives.map((primitive) => buildPrimitive(primitive, true, false)),
      colors: primitives.map((primitive) => {
        const material = primitive.material === null ? null : source.materials[primitive.material];
        return material?.baseColorFactor ?? [1, 1, 1, 1];
      }),
      maps: primitives.map((primitive) => {
        const material = primitive.material === null ? null : source.materials[primitive.material];
        return (material?.baseColorImage === null || material?.baseColorImage === undefined
          ? null
          : embedded[material.baseColorImage]) ?? fallback;
      }),
      pose: createPose(source),
      globals: new Float32Array(source.nodes.length * 16),
      joints: new Float32Array(Math.max(source.skins[0]?.joints.length ?? 1, 1) * 16),
      clips: source.animations.map((animation, index) => animation.name || `anim${index}`),
    });
  }

  const distances: number[] = [];
  const order: number[] = [];
  const pointLight: [number, number, number, number] = [0, 0, 0, 0];
  const pointLightColor: [number, number, number] = [1, 1, 1];
  const directionalLight: [number, number, number] = [0.4, 1, 0.6];
  const directionalLightColor: [number, number, number] = [1, 1, 1];
  const fog: [number, number, number, number] = [0, 0, 0, 0];
  const ambientTint: [number, number, number] = [1, 1, 1];
  const ambient: [number, number, number] = [0, 0, 0];
  const cameraUniformPosition: [number, number, number] = [0, 0, 0];
  const surfaceResolution: [number, number] = [1, 1];
  let appliedFilter: TextureFilter | null = null;
  let triangleCount = 0;
  let frame: RenderFrame | null = null;

  function textureOf(url: string | undefined, generation: GenerationId): Texture {
    const found = url ? textures.get(url) : undefined;
    const fallback = textures.get(options.manifest.fallbackTextures[generation]);
    if (!found && !fallback) throw new Error(`Texture is not preloaded: ${url ?? '(fallback)'}`);
    return found ?? fallback!;
  }

  function drawShape(shape: Shape): void {
    shape.vao.bind();
    gl.drawElements(shape.mode === 'lines' ? gl.LINES : gl.TRIANGLES, shape.count, shape.vao.indexType, 0);
    triangleCount += shape.triangles;
  }

  function ambientOf(material: MaterialCommand): [number, number, number] {
    for (let axis = 0; axis < 3; axis++) ambient[axis] = (material.ambient ?? 0.45) * ambientTint[axis]!;
    return ambient;
  }

  function beginPass(profile: HardwareGenerationProfile, active: RenderFrame): void {
    camera.projection = active.camera.projection === 'orthographic' ? 'ortho' : 'perspective';
    camera.orthoHeight = active.camera.orthoHeight ?? active.camera.zoom;
    camera.fovDegrees = active.camera.fovDegrees ?? 55;
    for (let axis = 0; axis < 3; axis++) {
      camera.position[axis] = active.camera.position[axis]!;
      camera.target[axis] = active.camera.target[axis]!;
      cameraUniformPosition[axis] = active.camera.position[axis]!;
    }
    camera.update(profile.video.internalWidth / profile.video.internalHeight);
    mat4.ortho(
      spriteProjection,
      0,
      profile.video.internalWidth,
      profile.video.internalHeight,
      0,
      -1,
      1,
    );
    if (appliedFilter !== profile.video.textureFilter) {
      for (const texture of textures.values()) texture.setFilter(profile.video.textureFilter);
      appliedFilter = profile.video.textureFilter;
    }
  }

  function backgroundsFor(active: RenderFrame, generation: GenerationId): BackgroundCommand[] {
    return active.backgrounds.filter((background) => applies(background, generation));
  }

  function drawBackground(profile: HardwareGenerationProfile, active: RenderFrame): void {
    const commands = backgroundsFor(active, profile.id);
    const sky = commands.find((command) => !command.texture);
    const layers = commands.filter((command) => command.texture);
    const top = colorFactor(sky?.secondaryColor ?? sky?.color);
    const bottom = colorFactor(sky?.color);
    const layerRect = (layer: BackgroundCommand | undefined): [number, number, number, number] => layer
      ? [
          layer.repeat?.[0] ?? 1,
          layer.offset?.[0] ?? 0,
          (layer.placement?.bottom ?? 0) + (layer.offset?.[1] ?? 0),
          layer.placement?.height ?? 1,
        ]
      : NO_LAYER;
    state.apply({ depthTest: false, depthWrite: false, blend: 'none', cull: 'none' });
    backgroundProgram.use();
    gl.bindVertexArray(null);
    backgroundProgram.setUniforms({
      uSkyTop: top.slice(0, 3),
      uSkyBottom: bottom.slice(0, 3),
      uFar: textureOf(layers[0]?.texture, profile.id),
      uNear: textureOf(layers[1]?.texture, profile.id),
      uFarRect: layerRect(layers[0]),
      uNearRect: layerRect(layers[1]),
      uBrightness: sky?.brightness ?? 1,
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    triangleCount++;
    state.apply({
      depthTest: profile.video.depthBuffer,
      depthWrite: profile.video.depthBuffer,
      blend: 'none',
      cull: 'back',
    });
  }

  function materialFor(mesh: MeshCommand): MaterialCommand {
    const material = mesh.material ? materialById.get(mesh.material) : undefined;
    if (!material) throw new Error(`Material is not present in RenderFrame: ${mesh.material ?? mesh.id}`);
    return material;
  }

  function meshParts(mesh: MeshCommand): Shape[] {
    if (mesh.asset) {
      const parts = modelParts.get(mesh.asset);
      if (!parts) throw new Error(`Model is not preloaded: ${mesh.asset}`);
      return parts;
    }
    const geometry = geometries.get(geometryCommandKey(mesh.geometry));
    if (!geometry) throw new Error(`Geometry is not preallocated: ${geometryCommandKey(mesh.geometry)}`);
    return [geometry];
  }

  function transformFor(mesh: MeshCommand, material: MaterialCommand, active: RenderFrame): void {
    const [x, y, z] = mesh.transform.position;
    const motion = options.motionAmount?.() ?? 1;
    const floating = material.floatAmplitude
      ? Math.sin(active.timeSeconds * FLOAT_RATE + x * 0.7 + z * 1.3) * material.floatAmplitude * motion
      : 0;
    mat4.identity(modelMatrix);
    mat4.translate(modelMatrix, modelMatrix, [x, y + floating, z]);
    if (mesh.transform.rotationY) mat4.rotateY(modelMatrix, modelMatrix, mesh.transform.rotationY);
    if (mesh.transform.scale) mat4.scale(modelMatrix, modelMatrix, mesh.transform.scale);
    if (mesh.geometry.kind === 'quad') {
      mat4.scale(modelMatrix, modelMatrix, [mesh.geometry.halfSize[0], 1, mesh.geometry.halfSize[1]]);
    }
  }

  function drawMesh(mesh: MeshCommand, profile: HardwareGenerationProfile, active: RenderFrame, parts?: readonly Shape[]): void {
    const material = materialFor(mesh);
    const environment = material.environmentTexture ? textures.get(material.environmentTexture) : undefined;
    transformFor(mesh, material, active);
    sceneProgram.use();
    sceneProgram.setUniforms({
      uModel: modelMatrix as Float32Array,
      uViewProjection: camera.viewProjection as Float32Array,
      uResolution: [profile.video.internalWidth, profile.video.internalHeight],
      uQuantizeStep: profile.video.vertexQuantize,
      uAffineAmount: profile.video.affineTexture ? 1 : 0,
      uBaseColor: textureOf(material.baseColorTexture, profile.id),
      uTopColor: textureOf(material.topColorTexture ?? material.baseColorTexture, profile.id),
      uBaseColorFactor: material.colorFactor ?? colorFactor(material.color ?? mesh.color),
      uLightDirection: directionalLight,
      uDirectionalColor: directionalLightColor,
      uAmbient: ambientOf(material),
      uDiffuse: material.diffuse ?? 0.55,
      uPointLight: pointLight,
      uPointLightColor: pointLightColor,
      uEnvironment: environment ?? textureOf(undefined, profile.id),
      uEnvironmentStrength: profile.video.environmentMap && environment
        ? Math.min(Math.max(material.environmentStrength ?? 0, 0), 1)
        : 0,
      uCameraPosition: cameraUniformPosition,
      uFog: fog,
      uUvScroll: [0, (material.uvScrollY ?? 0) * (options.motionAmount?.() ?? 1) * active.timeSeconds],
      uAlphaCutoff: material.alphaCutoff ?? 0,
    });
    const shouldSort = material.polygonSort && !profile.video.depthBuffer && profile.video.projection === 'perspective3d';
    for (const part of parts ?? meshParts(mesh)) {
      if (part.local) mat4.multiply(partMatrix, modelMatrix, part.local.matrix);
      sceneProgram.setUniforms({ uModel: (part.local ? partMatrix : modelMatrix) as Float32Array });
      if (shouldSort && part.sortable) {
        const scale = mesh.transform.scale ?? [1, 1, 1];
        for (let axis = 0; axis < 3; axis++) {
          localCamera[axis] = (camera.position[axis]! - mesh.transform.position[axis]!) / scale[axis]!;
        }
        if (part.local) vec3.transformMat4(localCamera, localCamera, part.local.inverse);
        sortTrianglesByDepth(part.sortable.positions, part.sortable.indices, localCamera, part.sortable.out, part.sortable.workspace);
        part.vao.updateIndices(part.sortable.out);
      }
      drawShape(part);
    }
  }

  function collectMeshes(active: RenderFrame, profile: HardwareGenerationProfile, translucent: boolean): number {
    let count = 0;
    for (let index = 0; index < active.meshes.length; index++) {
      const mesh = active.meshes[index]!;
      if (mesh.visible === false || !applies(mesh, profile.id)) continue;
      if (mesh.wireframe) continue;
      if ((mesh.layer ?? 0) < 0) continue;
      const material = materialFor(mesh);
      if ((material.blendMode === 'additive' || material.blendMode === 'alpha') !== translucent) continue;
      const dx = mesh.transform.position[0] - camera.position[0]!;
      const dy = mesh.transform.position[1] - camera.position[1]!;
      const dz = mesh.transform.position[2] - camera.position[2]!;
      distances[index] = dx * dx + dy * dy + dz * dz;
      order[count++] = index;
    }
    if (translucent || !profile.video.depthBuffer) {
      const sorted = order.slice(0, count).sort((a, b) => distances[b]! - distances[a]!);
      for (let index = 0; index < count; index++) order[index] = sorted[index]!;
    }
    return count;
  }

  function pointShadow(
    center: Vec3,
    half: Vec3,
    groundY: number,
    light: Vec3,
  ): { center: Vec3; half: Vec3; strength: number } {
    const toObject = light[1] - center[1];
    const toGround = light[1] - groundY;
    if (toObject <= 1e-3 || toGround <= 1e-3) return { center, half, strength: 0 };
    const stretch = Math.min(toGround / toObject, 3);
    return {
      center: [light[0] + (center[0] - light[0]) * stretch, groundY + 0.02, light[2] + (center[2] - light[2]) * stretch],
      half: [half[0] * stretch, 1, half[2] * stretch],
      strength: 1 / stretch,
    };
  }

  function drawShadows(profile: HardwareGenerationProfile, active: RenderFrame): void {
    if (pointLight[3] <= 0) return;
    state.apply({ blend: 'alpha', depthWrite: false });
    for (const mesh of active.meshes) {
      if (mesh.visible === false || !applies(mesh, profile.id) || !mesh.castShadow || mesh.groundY === undefined) continue;
      const half = mesh.transform.scale
        ?? (mesh.geometry.kind === 'box' ? mesh.geometry.halfExtents : undefined)
        ?? [1, 1, 1];
      const projected = pointShadow(
        mesh.transform.position,
        half,
        mesh.groundY,
        [pointLight[0], pointLight[1], pointLight[2]],
      );
      if (projected.strength <= 0) continue;
      mat4.identity(modelMatrix);
      mat4.translate(modelMatrix, modelMatrix, projected.center);
      mat4.scale(modelMatrix, modelMatrix, projected.half);
      const fallback = textureOf(undefined, profile.id);
      sceneProgram.use();
      sceneProgram.setUniforms({
        uModel: modelMatrix as Float32Array,
        uViewProjection: camera.viewProjection as Float32Array,
        uResolution: [profile.video.internalWidth, profile.video.internalHeight],
        uQuantizeStep: profile.video.vertexQuantize,
        uAffineAmount: profile.video.affineTexture ? 1 : 0,
        uBaseColor: fallback,
        uTopColor: fallback,
        uBaseColorFactor: [0, 0, 0, SHADOW_STRENGTH * projected.strength],
        uLightDirection: [0, 1, 0],
        uDirectionalColor: WHITE_LIGHT,
        uAmbient: WHITE_AMBIENT,
        uDiffuse: 0,
        uPointLight: NO_POINT_LIGHT,
        uPointLightColor: WHITE_LIGHT,
        uEnvironment: fallback,
        uEnvironmentStrength: 0,
        uCameraPosition: cameraUniformPosition,
        uFog: NO_FOG,
        uUvScroll: NO_UV_SCROLL,
        uAlphaCutoff: 0,
      });
      drawShape(shadowMesh);
    }
    state.apply({ blend: 'none', depthWrite: profile.video.depthBuffer });
  }

  function drawSkinned(command: SkinnedMeshCommand, profile: HardwareGenerationProfile): void {
    const rig = rigs.get(command.model);
    if (!rig) throw new Error(`Skinned model is not preloaded: ${command.model}`);
    const step = 1 / profile.video.animationHz;
    const quantized = Math.floor(command.animationTime / step) * step;
    const clipIndex = rig.clips.indexOf(command.clip);
    const animation = rig.model.animations[clipIndex >= 0 ? clipIndex : 0];
    if (animation) sampleAnimation(animation, quantized, rig.pose);
    computeGlobalMatrices(rig.model, rig.pose, rig.globals);
    if (rig.model.skins.length > 0) computeJointMatrices(rig.model, 0, rig.globals, rig.joints);
    mat4.identity(modelMatrix);
    mat4.translate(modelMatrix, modelMatrix, command.transform.position);
    if (command.transform.rotationY) mat4.rotateY(modelMatrix, modelMatrix, command.transform.rotationY);
    if (command.transform.scale) mat4.scale(modelMatrix, modelMatrix, command.transform.scale);
    skinProgram.use();
    const tint = command.tintFactor ?? colorFactor(command.tint);
    rig.parts.forEach((part, index) => {
      const base = rig.colors[index] ?? [1, 1, 1, 1];
      skinProgram.setUniforms({
        uJoints: rig.joints,
        uModel: modelMatrix as Float32Array,
        uViewProjection: camera.viewProjection as Float32Array,
        uResolution: [profile.video.internalWidth, profile.video.internalHeight],
        uQuantizeStep: profile.video.vertexQuantize,
        uAffineAmount: profile.video.affineTexture ? 1 : 0,
        uBaseColor: rig.maps[index]!,
        uTopColor: rig.maps[index]!,
        uBaseColorFactor: [base[0] * tint[0], base[1] * tint[1], base[2] * tint[2], base[3] * tint[3]],
        uLightDirection: directionalLight,
        uDirectionalColor: directionalLightColor,
        uAmbient: [0.45 * ambientTint[0], 0.45 * ambientTint[1], 0.45 * ambientTint[2]],
        uDiffuse: 0.55,
        uPointLight: pointLight,
        uPointLightColor: pointLightColor,
        uEnvironment: textureOf(undefined, profile.id),
        uEnvironmentStrength: 0,
        uCameraPosition: cameraUniformPosition,
        uFog: fog,
        uUvScroll: NO_UV_SCROLL,
        uAlphaCutoff: 0,
      });
      drawShape(part);
    });
  }

  function drawSprite(command: SpriteCommand, profile: HardwareGenerationProfile): void {
    const sheet = command.texture ? atlases.get(command.texture) : undefined;
    if (!sheet) throw new Error(`Sprite atlas is not preloaded: ${command.texture ?? command.id}`);
    const cell = Math.min(Math.max(command.cell ?? 0, 0), sheet.cells.length - 1);
    mat4.identity(modelMatrix);
    mat4.translate(modelMatrix, modelMatrix, command.position);
    if (command.rotation) mat4.rotateZ(modelMatrix, modelMatrix, command.rotation);
    mat4.scale(modelMatrix, modelMatrix, [
      (command.flipX ? -1 : 1) * command.size[0] / 2,
      command.size[1] / 2,
      1,
    ]);
    state.apply({ cull: 'none' });
    sceneProgram.use();
    sceneProgram.setUniforms({
      uModel: modelMatrix as Float32Array,
      uViewProjection: (command.screenSpace ? spriteProjection : camera.viewProjection) as Float32Array,
      uResolution: [profile.video.internalWidth, profile.video.internalHeight],
      uQuantizeStep: profile.video.vertexQuantize,
      uAffineAmount: profile.video.affineTexture ? 1 : 0,
      uBaseColor: sheet.texture,
      uTopColor: sheet.texture,
      uBaseColorFactor: colorFactor(command.color),
      uLightDirection: directionalLight,
      uDirectionalColor: directionalLightColor,
      uAmbient: WHITE_AMBIENT,
      uDiffuse: 0,
      uPointLight: pointLight,
      uPointLightColor: pointLightColor,
      uEnvironment: textureOf(undefined, profile.id),
      uEnvironmentStrength: 0,
      uCameraPosition: cameraUniformPosition,
      uFog: fog,
      uUvScroll: NO_UV_SCROLL,
      uAlphaCutoff: command.alphaCutoff ?? 0,
    });
    drawShape(sheet.cells[cell]!);
    state.apply({ cull: 'back' });
  }

  function configureLighting(profile: HardwareGenerationProfile, active: RenderFrame): void {
    const sky = backgroundsFor(active, profile.id).find((background) => !background.texture);
    const horizon = colorFactor(sky?.color).slice(0, 3);
    const brightness = sky?.brightness ?? 1;
    for (let axis = 0; axis < 3; axis++) fog[axis] = horizon[axis]! * brightness;
    fog[3] = sky?.fogDensity ?? 0;
    const skyLuma = luma(horizon);
    const fallbackAmbient: Vec3 = [
      skyLuma === 0 ? 1 : 1 + ((horizon[0]! / skyLuma) - 1) * brightness,
      skyLuma === 0 ? 1 : 1 + ((horizon[1]! / skyLuma) - 1) * brightness,
      skyLuma === 0 ? 1 : 1 + ((horizon[2]! / skyLuma) - 1) * brightness,
    ];
    const lighting = resolveFrameLighting(active.lights, profile.id, profile.video.dynamicLight, fallbackAmbient);
    for (let axis = 0; axis < 3; axis++) {
      ambientTint[axis] = lighting.ambient[axis]!;
      directionalLight[axis] = lighting.directionalDirection[axis]!;
      directionalLightColor[axis] = lighting.directionalColor[axis]!;
      pointLight[axis] = lighting.point[axis]!;
      pointLightColor[axis] = lighting.pointColor[axis]!;
    }
    pointLight[3] = lighting.point[3];
  }

  function drawSurfaces(profile: HardwareGenerationProfile, active: RenderFrame): void {
    surfaceResolution[0] = profile.video.internalWidth;
    surfaceResolution[1] = profile.video.internalHeight;
    if (profile.video.rasterScroll) {
      for (const command of active.rasterSurfaces) {
        if (!applies(command, profile.id)) continue;
        rasterSurfacePass.draw(command, textureOf(command.texture, profile.id), surfaceResolution);
        triangleCount++;
      }
    }
    if (profile.video.affinePlane) {
      for (const command of active.affineSurfaces) {
        if (!applies(command, profile.id)) continue;
        affineSurfacePass.draw(command, textureOf(command.texture, profile.id), surfaceResolution);
        triangleCount++;
      }
    }
    state.apply({
      depthTest: profile.video.depthBuffer,
      depthWrite: profile.video.depthBuffer,
      blend: 'none',
      cull: 'back',
    });
  }

  function drawScene(profile: HardwareGenerationProfile): void {
    const active = frame;
    if (!active) return;
    triangleCount = 0;
    materialById.clear();
    for (const material of active.materials) if (applies(material, profile.id)) materialById.set(material.id, material);
    beginPass(profile, active);
    configureLighting(profile, active);
    drawBackground(profile, active);
    drawSurfaces(profile, active);
    sceneProgram.use();
    for (const mesh of active.meshes) {
      if (mesh.visible === false || !applies(mesh, profile.id) || mesh.wireframe || (mesh.layer ?? 0) >= 0) continue;
      const material = materialFor(mesh);
      if (material.blendMode !== 'additive' && material.blendMode !== 'alpha') drawMesh(mesh, profile, active);
    }
    const opaque = collectMeshes(active, profile, false);
    for (let slot = 0; slot < opaque; slot++) drawMesh(active.meshes[order[slot]!]!, profile, active);
    drawShadows(profile, active);
    for (const command of active.skinnedMeshes) {
      if (command.visible !== false && applies(command, profile.id)) drawSkinned(command, profile);
    }
    const translucent = collectMeshes(active, profile, true);
    if (translucent > 0) {
      state.apply({ blend: 'add', depthWrite: false });
      const density = fog[3];
      fog[3] = 0;
      for (let slot = 0; slot < translucent; slot++) drawMesh(active.meshes[order[slot]!]!, profile, active);
      fog[3] = density;
      state.apply({ blend: 'none', depthWrite: profile.video.depthBuffer });
    }
    const wireframes = active.meshes.filter((mesh) => mesh.wireframe && mesh.visible !== false && applies(mesh, profile.id));
    if (wireframes.length > 0) {
      state.apply({ depthTest: false, depthWrite: false, blend: 'alpha', cull: 'none' });
      const density = fog[3];
      fog[3] = 0;
      for (const mesh of wireframes) drawMesh(mesh, profile, active, [wireframeMesh]);
      fog[3] = density;
      state.apply({
        depthTest: profile.video.depthBuffer,
        depthWrite: profile.video.depthBuffer,
        blend: 'none',
        cull: 'back',
      });
    }
  }

  function drawSprites(profile: HardwareGenerationProfile): void {
    const active = frame;
    if (!active) return;
    beginPass(profile, active);
    configureLighting(profile, active);
    for (const command of active.sprites) {
      if (command.visible !== false && applies(command, profile.id)) drawSprite(command, profile);
    }
  }

  function backgroundIndex(generation: GenerationId): number {
    if (!frame) return 52;
    const sky = backgroundsFor(frame, generation).find((background) => !background.texture);
    const bottom = colorFactor(sky?.color);
    return nearestMasterIndex(Math.round(bottom[0] * 255), Math.round(bottom[1] * 255), Math.round(bottom[2] * 255));
  }

  const pipeline = createGenerationPipeline(ctx, {
    quality: options.quality ?? (() => 'full'),
    ...(options.glitchAmount ? { glitchAmount: options.glitchAmount } : {}),
    ...(options.crtOverride ? { crtOverride: options.crtOverride } : {}),
    ...(options.transitionColors ? { transitionColors: options.transitionColors } : {}),
    backgroundPaletteIndex: backgroundIndex,
  });

  return {
    get renderedGenerations() {
      return pipeline.lastGenerationsDrawn;
    },
    get triangleCount() {
      return triangleCount;
    },
    render(active, generation): void {
      frame = active;
      pipeline.render({
        generation: generation.generation,
        from: generation.transition.active ? generation.transition.from : null,
        blend: generation.transition.blend,
        screenWidth: canvas.width,
        screenHeight: canvas.height,
        timeSeconds: active.timeSeconds,
      }, drawScene, drawSprites);
    },
    resize(): void {
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    dispose(): void {
      pipeline.dispose();
      for (const disposable of disposables) disposable.dispose();
    },
  };
}

export async function createGenerationWebGlRenderer(
  canvas: HTMLCanvasElement,
  options: GenerationWebGlRendererOptions,
): Promise<FrameRenderer & GenerationWebGlRendererStats> {
  const cpu = await loadCpuAssets(options.assets, options.manifest);
  const ctx = createGLContext(canvas);
  const key = `generation-webgl-renderer:${rendererSequence++}`;
  const gpu = await options.assets.acquireGpu(
    key,
    () => createGpuBackend(canvas, ctx, cpu, options),
    (backend) => backend.dispose(),
  );
  const disconnectRestore = ctx.onRestored(() => {
    void options.assets.restoreGpuResources();
  });
  let disposed = false;
  return {
    get allocatedTargets() {
      return 4;
    },
    get renderedGenerations() {
      return gpu.value.renderedGenerations;
    },
    get triangleCount() {
      return gpu.value.triangleCount;
    },
    render(frame, _profile, generation): void {
      gpu.value.render(frame, generation);
    },
    resize(): void {
      gpu.value.resize();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disconnectRestore();
      gpu.release();
      for (const handle of cpu.handles) handle.release();
      ctx.dispose();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
