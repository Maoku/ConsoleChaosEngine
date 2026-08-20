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
import {
  HARDWARE_GENERATION_PROFILES,
  type GenerationId,
  type HardwareGenerationProfile,
} from '../generation/profiles';
import { createCamera } from './camera';
import { createAffineSurfacePass } from './affine/pass';
import { spriteDepthWrite, writeSpriteModelMatrix } from './billboard';
import {
  assertHardwareBlendGenerations,
  createResolvedHardwareBlend,
  resolveHardwareBlend,
} from './blend';
import {
  createDrawPacketWorkspace,
  stableSortDrawPackets,
  type DrawPacket,
} from './draw-packet';
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
  BLEND_ALPHA,
  BLEND_NONE,
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
import {
  createOrderingTableWorkspace,
  defaultOrderingTableIndex,
  visitOrderingTable,
  type OrderingTableIndex,
} from './ordering-table';
import { resolveFrameLighting } from './lighting';
import type { CrtPreset, CrtQuality } from './postfx/presets';
import ps1Fragment from './shaders/ps1_forward';
import ps1Vertex from './shaders/ps1_vertex';
import skinnedVertex from './shaders/skinned_test.vert';
import backdropFragment from './shaders/backdrop.frag';
import backdropVertex from './shaders/backdrop.vert';
import {
  createOrderingPartitionWorkspace,
  createSortWorkspace,
  partitionTrianglesByViewDepth,
  sortTrianglesByDepth,
  type IndexArray,
  type TriangleOrderingPartitionWorkspace,
  type TriangleSortWorkspace,
} from './sort';
import { createRasterSurfacePass } from './raster/pass';
import type { FrameRenderer } from './renderer';

const WHITE_AMBIENT: [number, number, number] = [1, 1, 1];
const WHITE_LIGHT: [number, number, number] = [1, 1, 1];
const NO_POINT_LIGHT: [number, number, number, number] = [0, 0, 0, 0];
const NO_FOG: [number, number, number, number] = [0, 0, 0, 0];
const NO_UV_SCROLL: [number, number] = [0, 0];
const NO_LAYER: [number, number, number, number] = [0, 0, 0, 0];
const NO_BLEND_COLOR: [number, number, number, number] = [0, 0, 0, 0];
const DEFAULT_BLEND_CONTROL: [number, number] = [0, 1];
const SHADOW_STRENGTH = 0.72;
const FLOAT_RATE = 1;
const DRAW_PACKET_CAPACITY = 8192;

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
  /** Screenshot tooling can opt in without making the runtime retain every frame by default. */
  preserveDrawingBuffer?: boolean;
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
    indices: IndexArray;
    out: IndexArray;
    workspace: TriangleSortWorkspace;
    ordering: TriangleOrderingPartitionWorkspace;
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
  const modelViewMatrix = mat4.create();
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
    if (sortable) {
      shape.sortable = {
        positions: primitive.positions,
        indices: primitive.indices,
        out: primitive.indices instanceof Uint32Array
          ? new Uint32Array(primitive.indices.length)
          : new Uint16Array(primitive.indices.length),
        workspace: createSortWorkspace(primitive.indices.length / 3),
        ordering: createOrderingPartitionWorkspace(primitive.indices.length / 3),
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

  const distances = new Float32Array(DRAW_PACKET_CAPACITY);
  const order = new Uint32Array(DRAW_PACKET_CAPACITY);
  const orderingTable = createOrderingTableWorkspace<DrawPacket>();
  const drawPackets = createDrawPacketWorkspace(DRAW_PACKET_CAPACITY);
  const occupiedOrderingSlots = new Uint8Array(12);
  const resolvedBlend = createResolvedHardwareBlend();
  const blendControl: [number, number] = [0, 1];
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

  function drawShape(shape: Shape, firstIndex = 0, count = shape.count): void {
    shape.vao.drawElements(shape.mode === 'lines' ? gl.LINES : gl.TRIANGLES, count, firstIndex);
    triangleCount += shape.mode === 'lines' ? 0 : count / 3;
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
    state.apply({ depthTest: false, depthWrite: false, blend: BLEND_NONE, cull: 'none' });
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
      blend: BLEND_NONE,
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

  function drawMesh(
    mesh: MeshCommand,
    profile: HardwareGenerationProfile,
    active: RenderFrame,
    parts?: readonly Shape[],
    polygonSlot?: OrderingTableIndex,
  ): void {
    const material = materialFor(mesh);
    const blend = resolveHardwareBlend(profile.id, material.hardwareBlend, material.blendMode, resolvedBlend);
    if (!blend.visible) return;
    blendControl[0] = blend.premultiplyColor ? 1 : 0;
    blendControl[1] = blend.outputOpacity;
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
      uTweenColor: textureOf(material.baseColorTexture, profile.id),
      uTextureMix: 0,
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
      uBlendColorOverride: blend.colorOverride,
      uBlendControl: blendControl,
    });
    const shouldSort = material.polygonSort && !profile.video.depthBuffer && profile.video.projection === 'perspective3d';
    for (const part of parts ?? meshParts(mesh)) {
      if (part.local) mat4.multiply(partMatrix, modelMatrix, part.local.matrix);
      sceneProgram.setUniforms({ uModel: (part.local ? partMatrix : modelMatrix) as Float32Array });
      if (shouldSort && part.sortable) {
        if (profile.id === 'PS1' && polygonSlot !== undefined) {
          const range = part.sortable.ordering.ranges[polygonSlot]!;
          if (range.count > 0) drawShape(part, range.firstIndex, range.count);
          continue;
        }
        const scale = mesh.transform.scale ?? [1, 1, 1];
        for (let axis = 0; axis < 3; axis++) localCamera[axis] = (camera.position[axis]! - mesh.transform.position[axis]!) / scale[axis]!;
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
      if (index >= order.length) throw new RangeError(`Draw order capacity ${order.length} exceeded`);
      const mesh = active.meshes[index]!;
      if (mesh.visible === false || !applies(mesh, profile.id)) continue;
      if (mesh.wireframe) continue;
      if ((mesh.layer ?? 0) < 0) continue;
      const material = materialFor(mesh);
      const blend = resolveHardwareBlend(profile.id, material.hardwareBlend, material.blendMode, resolvedBlend);
      if (!blend.visible || blend.translucent !== translucent) continue;
      const dx = mesh.transform.position[0] - camera.position[0]!;
      const dy = mesh.transform.position[1] - camera.position[1]!;
      const dz = mesh.transform.position[2] - camera.position[2]!;
      distances[index] = dx * dx + dy * dy + dz * dz;
      order[count++] = index;
    }
    if (translucent || !profile.video.depthBuffer) {
      for (let index = 1; index < count; index++) {
        const meshIndex = order[index]!;
        const distance = distances[meshIndex]!;
        let insertion = index;
        while (insertion > 0 && distances[order[insertion - 1]!]! < distance) {
          order[insertion] = order[insertion - 1]!;
          insertion--;
        }
        order[insertion] = meshIndex;
      }
    }
    return count;
  }

  function viewDepth(position: Vec3): number {
    return -(
      camera.view[2]! * position[0]
      + camera.view[6]! * position[1]
      + camera.view[10]! * position[2]
      + camera.view[14]!
    );
  }

  function materialBlend(profile: HardwareGenerationProfile, material: MaterialCommand | undefined) {
    return resolveHardwareBlend(profile.id, material?.hardwareBlend, material?.blendMode, resolvedBlend);
  }

  function prepareMeshOrdering(
    mesh: MeshCommand,
    material: MaterialCommand,
    active: RenderFrame,
    range: readonly [OrderingTableIndex, OrderingTableIndex],
  ): boolean {
    occupiedOrderingSlots.fill(0);
    transformFor(mesh, material, active);
    let prepared = false;
    for (const part of meshParts(mesh)) {
      if (!part.sortable) continue;
      const localToWorld = part.local
        ? mat4.multiply(partMatrix, modelMatrix, part.local.matrix)
        : modelMatrix;
      mat4.multiply(modelViewMatrix, camera.view, localToWorld);
      const ranges = partitionTrianglesByViewDepth(
        part.sortable.positions,
        part.sortable.indices,
        modelViewMatrix,
        camera.near,
        camera.far,
        range,
        part.sortable.out,
        part.sortable.ordering,
      );
      part.vao.updateIndices(part.sortable.out);
      for (let slot = range[0]; slot <= range[1]; slot++) {
        if (ranges[slot]!.count > 0) occupiedOrderingSlots[slot] = 1;
      }
      prepared = true;
    }
    return prepared;
  }

  function registerGen3Packet(packet: DrawPacket, index: OrderingTableIndex): void {
    orderingTable.lists[index]!.push(packet);
  }

  function collectGen3Packets(active: RenderFrame): void {
    drawPackets.reset();
    orderingTable.reset();
    for (const mesh of active.meshes) {
      if (mesh.visible === false || !applies(mesh, 'PS1')) continue;
      const material = materialFor(mesh);
      const blend = materialBlend(HARDWARE_GENERATION_PROFILES.PS1, material);
      if (!blend.visible) continue;
      const translucent = blend.translucent;
      const depth = viewDepth(mesh.transform.position);
      if (mesh.wireframe) {
        const packet = drawPackets.take('mesh', mesh);
        packet.material = material;
        packet.viewDepth = depth;
        packet.debug = true;
        registerGen3Packet(packet, mesh.orderTableIndex ?? 11);
        continue;
      }
      if (material.polygonSort) {
        const fixedIndex = mesh.orderTableIndex;
        const range = fixedIndex !== undefined
          ? [fixedIndex, fixedIndex] as const
          : mesh.polygonSortRange ?? (translucent ? [9, 9] as const : [1, 8] as const);
        if (prepareMeshOrdering(mesh, material, active, range)) {
          for (let slot = range[0]; slot <= range[1]; slot++) {
            if (occupiedOrderingSlots[slot] === 0) continue;
            const packet = drawPackets.take('mesh', mesh);
            packet.material = material;
            packet.viewDepth = depth;
            packet.translucent = translucent;
            packet.polygonSlot = slot as OrderingTableIndex;
            registerGen3Packet(packet, slot as OrderingTableIndex);
          }
          continue;
        }
      }
      const packet = drawPackets.take('mesh', mesh);
      packet.material = material;
      packet.viewDepth = depth;
      packet.translucent = translucent;
      registerGen3Packet(packet, defaultOrderingTableIndex({
        ...(mesh.orderTableIndex !== undefined ? { explicit: mesh.orderTableIndex } : {}),
        kind: 'world',
        translucent,
        viewDepth: depth,
        nearDepth: camera.near,
        farDepth: camera.far,
      }));
    }
    for (const command of active.skinnedMeshes) {
      if (command.visible === false || !applies(command, 'PS1')) continue;
      const material = command.material ? materialById.get(command.material) : undefined;
      const blend = materialBlend(HARDWARE_GENERATION_PROFILES.PS1, material);
      if (!blend.visible) continue;
      const packet = drawPackets.take('skinned-mesh', command);
      packet.material = material;
      packet.viewDepth = viewDepth(command.transform.position);
      packet.translucent = blend.translucent;
      registerGen3Packet(packet, defaultOrderingTableIndex({
        ...(command.orderTableIndex !== undefined ? { explicit: command.orderTableIndex } : {}),
        kind: 'world',
        translucent: packet.translucent,
        viewDepth: packet.viewDepth,
        nearDepth: camera.near,
        farDepth: camera.far,
      }));
    }
    for (const command of active.sprites) {
      if (command.visible === false || !applies(command, 'PS1')) continue;
      assertHardwareBlendGenerations(command.generations, command.hardwareBlend);
      const blend = resolveHardwareBlend('PS1', command.hardwareBlend, undefined, resolvedBlend);
      if (!blend.visible) continue;
      const packet = drawPackets.take('sprite', command);
      packet.viewDepth = command.screenSpace ? 0 : viewDepth(command.position);
      packet.translucent = blend.translucent;
      registerGen3Packet(packet, defaultOrderingTableIndex({
        ...(command.orderTableIndex !== undefined ? { explicit: command.orderTableIndex } : {}),
        kind: command.screenSpace ? 'screen-space' : 'world',
        translucent: packet.translucent,
        viewDepth: packet.viewDepth,
        nearDepth: camera.near,
        farDepth: camera.far,
      }));
    }
    for (let slot = 0; slot <= 9; slot++) stableSortDrawPackets(orderingTable.lists[slot]!);
  }

  function packetBlend(profile: HardwareGenerationProfile, packet: DrawPacket) {
    if (packet.kind === 'sprite') {
      return resolveHardwareBlend(
        profile.id,
        (packet.command as SpriteCommand).hardwareBlend,
        undefined,
        resolvedBlend,
      );
    }
    return materialBlend(profile, packet.material);
  }

  function drawGen3Packets(profile: HardwareGenerationProfile, active: RenderFrame): void {
    collectGen3Packets(active);
    const fogDensity = fog[3];
    visitOrderingTable(orderingTable, (packet) => {
      if (!packet.command) return;
      if (packet.debug) {
        state.apply({ depthTest: false, depthWrite: false, blend: BLEND_ALPHA, cull: 'none' });
        fog[3] = 0;
        drawMesh(packet.command as MeshCommand, profile, active, [wireframeMesh]);
        return;
      }
      const blend = packetBlend(profile, packet);
      state.apply({
        depthTest: false,
        depthWrite: false,
        blend: packet.translucent ? blend.state : BLEND_NONE,
        cull: 'back',
      });
      const screenSpace = packet.kind === 'sprite' && (packet.command as SpriteCommand).screenSpace;
      fog[3] = packet.translucent || screenSpace ? 0 : fogDensity;
      if (packet.kind === 'mesh') {
        drawMesh(packet.command as MeshCommand, profile, active, undefined, packet.polygonSlot);
      } else if (packet.kind === 'skinned-mesh') {
        drawSkinned(packet.command as SkinnedMeshCommand, profile);
      } else if (packet.kind === 'sprite') {
        drawSprite(packet.command as SpriteCommand, profile);
      }
    });
    fog[3] = fogDensity;
    state.apply({ depthTest: false, depthWrite: false, blend: BLEND_NONE, cull: 'back' });
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
    state.apply({ blend: BLEND_ALPHA, depthWrite: false });
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
        uTweenColor: fallback,
        uTextureMix: 0,
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
        uBlendColorOverride: NO_BLEND_COLOR,
        uBlendControl: DEFAULT_BLEND_CONTROL,
      });
      drawShape(shadowMesh);
    }
    state.apply({ blend: BLEND_NONE, depthWrite: profile.video.depthBuffer });
  }

  function drawSkinned(command: SkinnedMeshCommand, profile: HardwareGenerationProfile): void {
    const rig = rigs.get(command.model);
    if (!rig) throw new Error(`Skinned model is not preloaded: ${command.model}`);
    const step = 1 / profile.video.animationHz;
    const quantized = Math.floor(command.animationTime / step) * step;
    const clipIndex = rig.clips.indexOf(command.clip);
    const animation = rig.model.animations[clipIndex >= 0 ? clipIndex : 0];
    if (animation) sampleAnimation(animation, quantized, rig.pose, command.loop ?? true);
    computeGlobalMatrices(rig.model, rig.pose, rig.globals);
    if (rig.model.skins.length > 0) computeJointMatrices(rig.model, 0, rig.globals, rig.joints);
    mat4.identity(modelMatrix);
    mat4.translate(modelMatrix, modelMatrix, command.transform.position);
    if (command.transform.rotationY) mat4.rotateY(modelMatrix, modelMatrix, command.transform.rotationY);
    if (command.transform.scale) mat4.scale(modelMatrix, modelMatrix, command.transform.scale);
    skinProgram.use();
    const tint = command.tintFactor ?? colorFactor(command.tint);
    const material = command.material ? materialById.get(command.material) : undefined;
    const blend = materialBlend(profile, material);
    if (!blend.visible) return;
    blendControl[0] = blend.premultiplyColor ? 1 : 0;
    blendControl[1] = blend.outputOpacity;
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
        uTweenColor: rig.maps[index]!,
        uTextureMix: 0,
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
        uBlendColorOverride: blend.colorOverride,
        uBlendControl: blendControl,
      });
      drawShape(part);
    });
  }

  function drawSprite(command: SpriteCommand, profile: HardwareGenerationProfile): void {
    const blend = resolveHardwareBlend(profile.id, command.hardwareBlend, undefined, resolvedBlend);
    if (!blend.visible) return;
    blendControl[0] = blend.premultiplyColor ? 1 : 0;
    blendControl[1] = blend.outputOpacity;
    const sheet = command.texture ? atlases.get(command.texture) : undefined;
    if (!sheet) throw new Error(`Sprite atlas is not preloaded: ${command.texture ?? command.id}`);
    const tweenSheet = command.tweenTexture ? atlases.get(command.tweenTexture) : sheet;
    if (!tweenSheet) throw new Error(`Sprite tween atlas is not preloaded: ${command.tweenTexture}`);
    const cell = Math.min(Math.max(command.cell ?? 0, 0), sheet.cells.length - 1);
    const billboard = profile.video.spriteComposition === 'scene' && !command.screenSpace
      ? command.billboard ?? 'cylindrical'
      : 'none';
    writeSpriteModelMatrix(modelMatrix, command, camera.position, camera.up, billboard);
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
      uTweenColor: tweenSheet.texture,
      uTextureMix: Math.min(Math.max(command.textureMix ?? 0, 0), 1),
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
      uBlendColorOverride: blend.colorOverride,
      uBlendControl: blendControl,
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
      blend: BLEND_NONE,
      cull: 'back',
    });
  }

  function collectSceneSprites(
    active: RenderFrame,
    profile: HardwareGenerationProfile,
    screenSpace: boolean,
    translucent: boolean,
  ): number {
    let count = 0;
    for (let index = 0; index < active.sprites.length; index++) {
      if (index >= order.length) throw new RangeError(`Draw order capacity ${order.length} exceeded`);
      const command = active.sprites[index]!;
      if (command.visible === false || !applies(command, profile.id) || Boolean(command.screenSpace) !== screenSpace) continue;
      assertHardwareBlendGenerations(command.generations, command.hardwareBlend);
      const blend = resolveHardwareBlend(profile.id, command.hardwareBlend, undefined, resolvedBlend);
      if (!blend.visible || blend.translucent !== translucent) continue;
      distances[index] = screenSpace ? 0 : viewDepth(command.position);
      order[count++] = index;
    }
    if (!screenSpace && translucent) {
      for (let index = 1; index < count; index++) {
        const spriteIndex = order[index]!;
        const depth = distances[spriteIndex]!;
        let insertion = index;
        while (insertion > 0 && distances[order[insertion - 1]!]! < depth) {
          order[insertion] = order[insertion - 1]!;
          insertion--;
        }
        order[insertion] = spriteIndex;
      }
    }
    return count;
  }

  function drawGen4WorldSprites(
    profile: HardwareGenerationProfile,
    active: RenderFrame,
    translucent: boolean,
    fogDensity: number,
  ): void {
    const count = collectSceneSprites(active, profile, false, translucent);
    for (let index = 0; index < count; index++) {
      const command = active.sprites[order[index]!]!;
      const blend = resolveHardwareBlend(profile.id, command.hardwareBlend, undefined, resolvedBlend);
      state.apply({
        depthTest: true,
        depthWrite: spriteDepthWrite(command, translucent),
        blend: translucent ? blend.state : BLEND_NONE,
        cull: 'none',
      });
      fog[3] = fogDensity;
      drawSprite(command, profile);
    }
  }

  function drawGen4Sprites(profile: HardwareGenerationProfile, active: RenderFrame): void {
    const fogDensity = fog[3];
    drawGen4WorldSprites(profile, active, false, fogDensity);
    drawGen4WorldSprites(profile, active, true, fogDensity);
    fog[3] = 0;
    for (const command of active.sprites) {
      if (command.visible === false || !applies(command, profile.id) || !command.screenSpace) continue;
      assertHardwareBlendGenerations(command.generations, command.hardwareBlend);
      const blend = resolveHardwareBlend(profile.id, command.hardwareBlend, undefined, resolvedBlend);
      if (!blend.visible) continue;
      state.apply({
        depthTest: false,
        depthWrite: false,
        blend: blend.translucent ? blend.state : BLEND_NONE,
        cull: 'none',
      });
      drawSprite(command, profile);
    }
    fog[3] = fogDensity;
    state.apply({ depthTest: true, depthWrite: true, blend: BLEND_NONE, cull: 'back' });
  }

  function drawScene(profile: HardwareGenerationProfile): void {
    const active = frame;
    if (!active) return;
    triangleCount = 0;
    materialById.clear();
    for (const material of active.materials) {
      assertHardwareBlendGenerations(material.generations, material.hardwareBlend);
      if (applies(material, profile.id)) materialById.set(material.id, material);
    }
    beginPass(profile, active);
    configureLighting(profile, active);
    drawBackground(profile, active);
    drawSurfaces(profile, active);
    sceneProgram.use();
    if (profile.id === 'PS1') {
      drawGen3Packets(profile, active);
      return;
    }
    for (const mesh of active.meshes) {
      if (mesh.visible === false || !applies(mesh, profile.id) || mesh.wireframe || (mesh.layer ?? 0) >= 0) continue;
      const material = materialFor(mesh);
      if (!materialBlend(profile, material).translucent) drawMesh(mesh, profile, active);
    }
    const opaque = collectMeshes(active, profile, false);
    for (let slot = 0; slot < opaque; slot++) drawMesh(active.meshes[order[slot]!]!, profile, active);
    drawShadows(profile, active);
    for (const command of active.skinnedMeshes) {
      if (command.visible === false || !applies(command, profile.id)) continue;
      const material = command.material ? materialById.get(command.material) : undefined;
      const blend = materialBlend(profile, material);
      if (!blend.visible || blend.translucent) continue;
      drawSkinned(command, profile);
    }
    const translucent = collectMeshes(active, profile, true);
    if (translucent > 0) {
      const density = fog[3];
      fog[3] = 0;
      for (let slot = 0; slot < translucent; slot++) {
        const mesh = active.meshes[order[slot]!]!;
        const material = materialFor(mesh);
        const blend = materialBlend(profile, material);
        state.apply({ blend: blend.state, depthWrite: false });
        drawMesh(mesh, profile, active);
      }
      fog[3] = density;
      state.apply({ blend: BLEND_NONE, depthWrite: profile.video.depthBuffer });
    }
    for (const command of active.skinnedMeshes) {
      if (command.visible === false || !applies(command, profile.id)) continue;
      const material = command.material ? materialById.get(command.material) : undefined;
      const blend = materialBlend(profile, material);
      if (!blend.visible || !blend.translucent) continue;
      state.apply({ blend: blend.state, depthWrite: false });
      const density = fog[3];
      fog[3] = 0;
      drawSkinned(command, profile);
      fog[3] = density;
    }
    state.apply({ blend: BLEND_NONE, depthWrite: profile.video.depthBuffer });
    if (profile.id === 'SFC') {
      for (const command of active.sprites) {
        if (command.visible === false || !applies(command, profile.id)) continue;
        assertHardwareBlendGenerations(command.generations, command.hardwareBlend);
        const blend = resolveHardwareBlend(profile.id, command.hardwareBlend, undefined, resolvedBlend);
        if (!blend.visible || !blend.translucent) continue;
        state.apply({ depthTest: false, depthWrite: false, blend: blend.state, cull: 'none' });
        const density = fog[3];
        fog[3] = 0;
        drawSprite(command, profile);
        fog[3] = density;
      }
      state.apply({ depthTest: false, depthWrite: false, blend: BLEND_NONE, cull: 'back' });
    }
    if (profile.id === 'PS2') drawGen4Sprites(profile, active);
    const wireframes = active.meshes.filter((mesh) => mesh.wireframe && mesh.visible !== false && applies(mesh, profile.id));
    if (wireframes.length > 0) {
      state.apply({ depthTest: false, depthWrite: false, blend: BLEND_ALPHA, cull: 'none' });
      const density = fog[3];
      fog[3] = 0;
      for (const mesh of wireframes) drawMesh(mesh, profile, active, [wireframeMesh]);
      fog[3] = density;
      state.apply({
        depthTest: profile.video.depthBuffer,
        depthWrite: profile.video.depthBuffer,
        blend: BLEND_NONE,
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
      if (command.visible === false || !applies(command, profile.id)) continue;
      assertHardwareBlendGenerations(command.generations, command.hardwareBlend);
      const blend = resolveHardwareBlend(profile.id, command.hardwareBlend, undefined, resolvedBlend);
      if (!blend.visible || blend.translucent) continue;
      drawSprite(command, profile);
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
  const ctx = createGLContext(canvas, {
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  });
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
