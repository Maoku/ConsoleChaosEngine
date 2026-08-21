/**
 * glTF 2.0 サブセットローダ（T0-06、§3）。
 *
 * 汎用ローダは作らない。本作が使う範囲だけを読み、範囲外は**明示的に失敗させる**。
 * 対応範囲は Docs/asset-rules.md に文書化し、tools/gltf-preflight.ts が CI で検査する。
 *
 * 対応: .gltf / .glb、TRIANGLES、POSITION / NORMAL / TEXCOORD_0 / JOINTS_0 / WEIGHTS_0、
 *       baseColorTexture と baseColorFactor、スキン、TRS のキーフレームアニメ（LINEAR / STEP）
 * 非対応: モーフターゲット、CUBICSPLINE、スパースアクセサ、拡張、カメラ、複数 UV セット
 */

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export interface GltfPrimitive {
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  joints: Uint16Array | null;
  weights: Float32Array | null;
  indices: Uint16Array | Uint32Array;
  material: number | null;
}

export interface GltfMesh {
  name: string;
  primitives: GltfPrimitive[];
}

export interface GltfNode {
  name: string;
  translation: Vec3;
  rotation: Vec4; // クォータニオン (x, y, z, w)
  scale: Vec3;
  children: number[];
  mesh: number | null;
  skin: number | null;
}

export interface GltfSkin {
  joints: number[];
  inverseBindMatrices: Float32Array; // 16 * joints.length
}

export type AnimationPath = 'translation' | 'rotation' | 'scale';

export interface GltfAnimationChannel {
  node: number;
  path: AnimationPath;
  interpolation: 'LINEAR' | 'STEP';
  times: Float32Array;
  values: Float32Array;
}

export interface GltfAnimation {
  name: string;
  channels: GltfAnimationChannel[];
  durationSeconds: number;
}

export interface GltfMaterial {
  name: string;
  baseColorFactor: Vec4;
  /** images[] のインデックス */
  baseColorImage: number | null;
}

export interface GltfImage {
  name: string;
  /** 外部ファイル参照。埋め込みの場合は null */
  uri: string | null;
  /** 埋め込みバイナリ（data: URI または bufferView） */
  data: Uint8Array | null;
  mimeType: string;
}

export interface GltfModel {
  nodes: GltfNode[];
  /** シーンのルートノード */
  roots: number[];
  meshes: GltfMesh[];
  skins: GltfSkin[];
  animations: GltfAnimation[];
  materials: GltfMaterial[];
  images: GltfImage[];
}

export interface GltfIO {
  fetchJson(url: string): Promise<unknown>;
  fetchBinary(url: string): Promise<ArrayBuffer>;
}

export const browserIO: GltfIO = {
  async fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`glTF を取得できない: ${url} (${res.status})`);
    return res.json();
  },
  async fetchBinary(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`バイナリを取得できない: ${url} (${res.status})`);
    return res.arrayBuffer();
  },
};

/** サブセット外のアセットに当たったことを、原因が分かる形で伝える */
export class GltfSubsetError extends Error {
  constructor(message: string) {
    super(`${message}\n対応範囲は Docs/asset-rules.md を参照`);
    this.name = 'GltfSubsetError';
  }
}

// --- glTF JSON の最小型 ------------------------------------------------------

interface RawAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  sparse?: unknown;
}

interface RawBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface RawGltf {
  asset?: { version?: string };
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<Record<string, unknown>>;
  meshes?: Array<Record<string, unknown>>;
  skins?: Array<Record<string, unknown>>;
  animations?: Array<Record<string, unknown>>;
  materials?: Array<Record<string, unknown>>;
  textures?: Array<{ source?: number }>;
  images?: Array<{ name?: string; uri?: string; bufferView?: number; mimeType?: string }>;
  accessors?: RawAccessor[];
  bufferViews?: RawBufferView[];
  buffers?: Array<{ uri?: string; byteLength: number }>;
  extensionsRequired?: string[];
}

const COMPONENT_SIZE: Record<number, number> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

function decodeBase64(base64: string): Uint8Array {
  // ブラウザ・Node の双方で動く経路のみを使う
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  const nodeBuffer = (globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer;
  if (!nodeBuffer) throw new Error('base64 をデコードする手段がない');
  return nodeBuffer.from(base64, 'base64');
}

function resolveUri(baseUrl: string, uri: string): string {
  if (/^(data:|https?:|\/|[a-z]:[\\/]|\\\\)/i.test(uri)) return uri;
  // Browser URL は `/`、Windows 上の preflight は `\` を使う。
  // どちらか一方だけを見ると `C:\...\models\player.gltf` の外部
  // buffer が cwd 直下の `player.bin` として解決されてしまう。
  const slash = Math.max(baseUrl.lastIndexOf('/'), baseUrl.lastIndexOf('\\'));
  return slash >= 0 ? `${baseUrl.slice(0, slash + 1)}${uri}` : uri;
}

async function loadBuffers(
  raw: RawGltf,
  baseUrl: string,
  io: GltfIO,
  glbBinary: Uint8Array | null,
): Promise<Uint8Array[]> {
  const buffers: Uint8Array[] = [];
  for (const [index, buffer] of (raw.buffers ?? []).entries()) {
    if (buffer.uri === undefined) {
      if (!glbBinary) throw new GltfSubsetError(`buffer[${index}] に uri も GLB バイナリもない`);
      buffers.push(glbBinary);
      continue;
    }
    if (buffer.uri.startsWith('data:')) {
      const comma = buffer.uri.indexOf(',');
      buffers.push(decodeBase64(buffer.uri.slice(comma + 1)));
      continue;
    }
    const bin = await io.fetchBinary(resolveUri(baseUrl, buffer.uri));
    buffers.push(new Uint8Array(bin));
  }
  return buffers;
}

/** アクセサを型付き配列として取り出す。インターリーブ（byteStride）にも対応する */
function readAccessor(raw: RawGltf, buffers: Uint8Array[], index: number): Float32Array | Uint32Array | Uint16Array {
  const accessor = raw.accessors?.[index];
  if (!accessor) throw new GltfSubsetError(`accessor[${index}] が無い`);
  if (accessor.sparse) throw new GltfSubsetError('スパースアクセサは非対応');
  const components = TYPE_COMPONENTS[accessor.type];
  if (!components) throw new GltfSubsetError(`未対応のアクセサ型: ${accessor.type}`);
  const componentSize = COMPONENT_SIZE[accessor.componentType];
  if (!componentSize) throw new GltfSubsetError(`未対応の componentType: ${accessor.componentType}`);

  const total = accessor.count * components;
  const out =
    accessor.componentType === 5126
      ? new Float32Array(total)
      : accessor.componentType === 5125
        ? new Uint32Array(total)
        : new Uint16Array(total);

  if (accessor.bufferView === undefined) return out; // 既定値ゼロ埋め

  const view = raw.bufferViews?.[accessor.bufferView];
  if (!view) throw new GltfSubsetError(`bufferView[${accessor.bufferView}] が無い`);
  const buffer = buffers[view.buffer];
  if (!buffer) throw new GltfSubsetError(`buffer[${view.buffer}] が無い`);

  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? components * componentSize;
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  for (let i = 0; i < accessor.count; i++) {
    const elementOffset = base + i * stride;
    for (let c = 0; c < components; c++) {
      const offset = elementOffset + c * componentSize;
      let value: number;
      switch (accessor.componentType) {
        case 5126:
          value = dv.getFloat32(offset, true);
          break;
        case 5125:
          value = dv.getUint32(offset, true);
          break;
        case 5123:
          value = dv.getUint16(offset, true);
          break;
        case 5121:
          value = dv.getUint8(offset);
          break;
        case 5122:
          value = dv.getInt16(offset, true);
          break;
        default:
          value = dv.getInt8(offset);
      }
      out[i * components + c] = value;
    }
  }
  return out;
}

function asFloat32(data: Float32Array | Uint32Array | Uint16Array): Float32Array {
  return data instanceof Float32Array ? data : Float32Array.from(data);
}

function parsePrimitive(raw: RawGltf, buffers: Uint8Array[], prim: Record<string, unknown>): GltfPrimitive {
  const mode = (prim['mode'] as number | undefined) ?? 4;
  if (mode !== 4) throw new GltfSubsetError(`TRIANGLES 以外の mode は非対応: ${mode}`);
  if (prim['targets']) throw new GltfSubsetError('モーフターゲットは非対応');

  const attributes = prim['attributes'] as Record<string, number>;
  if (attributes['POSITION'] === undefined) throw new GltfSubsetError('POSITION の無いプリミティブ');
  if (attributes['TEXCOORD_1'] !== undefined) throw new GltfSubsetError('複数 UV セットは非対応');

  const positions = asFloat32(readAccessor(raw, buffers, attributes['POSITION']));
  const normals =
    attributes['NORMAL'] !== undefined ? asFloat32(readAccessor(raw, buffers, attributes['NORMAL'])) : null;
  const uvs =
    attributes['TEXCOORD_0'] !== undefined
      ? asFloat32(readAccessor(raw, buffers, attributes['TEXCOORD_0']))
      : null;
  const jointsRaw = attributes['JOINTS_0'] !== undefined ? readAccessor(raw, buffers, attributes['JOINTS_0']) : null;
  const weights =
    attributes['WEIGHTS_0'] !== undefined ? asFloat32(readAccessor(raw, buffers, attributes['WEIGHTS_0'])) : null;

  const indicesIndex = prim['indices'] as number | undefined;
  if (indicesIndex === undefined) throw new GltfSubsetError('インデックスの無いプリミティブは非対応');
  const indicesRaw = readAccessor(raw, buffers, indicesIndex);
  const indices =
    indicesRaw instanceof Uint32Array
      ? indicesRaw
      : indicesRaw instanceof Uint16Array
        ? indicesRaw
        : Uint16Array.from(indicesRaw);

  return {
    positions,
    normals,
    uvs,
    joints: jointsRaw === null ? null : Uint16Array.from(jointsRaw),
    weights,
    indices,
    material: (prim['material'] as number | undefined) ?? null,
  };
}

function parseNode(node: Record<string, unknown>, index: number): GltfNode {
  if (node['matrix']) {
    // TRS へ分解する処理を持たない。Blender 側で TRS 出力にする（asset-rules.md）
    throw new GltfSubsetError(`node[${index}] が matrix を持つ。TRS で出力すること`);
  }
  return {
    name: (node['name'] as string | undefined) ?? `node${index}`,
    translation: ((node['translation'] as Vec3 | undefined) ?? [0, 0, 0]).slice() as Vec3,
    rotation: ((node['rotation'] as Vec4 | undefined) ?? [0, 0, 0, 1]).slice() as Vec4,
    scale: ((node['scale'] as Vec3 | undefined) ?? [1, 1, 1]).slice() as Vec3,
    children: ((node['children'] as number[] | undefined) ?? []).slice(),
    mesh: (node['mesh'] as number | undefined) ?? null,
    skin: (node['skin'] as number | undefined) ?? null,
  };
}

function parseAnimation(
  raw: RawGltf,
  buffers: Uint8Array[],
  animation: Record<string, unknown>,
  index: number,
): GltfAnimation {
  const samplers = (animation['samplers'] ?? []) as Array<{
    input: number;
    output: number;
    interpolation?: string;
  }>;
  const rawChannels = (animation['channels'] ?? []) as Array<{
    sampler: number;
    target: { node?: number; path: string };
  }>;

  const channels: GltfAnimationChannel[] = [];
  let duration = 0;

  for (const channel of rawChannels) {
    const sampler = samplers[channel.sampler];
    if (!sampler) throw new GltfSubsetError(`animation[${index}] のサンプラ参照が壊れている`);
    const interpolation = sampler.interpolation ?? 'LINEAR';
    if (interpolation !== 'LINEAR' && interpolation !== 'STEP') {
      throw new GltfSubsetError(`未対応の補間: ${interpolation}（LINEAR / STEP のみ）`);
    }
    const path = channel.target.path;
    if (path !== 'translation' && path !== 'rotation' && path !== 'scale') {
      throw new GltfSubsetError(`未対応のアニメーション対象: ${path}`);
    }
    if (channel.target.node === undefined) continue;

    const times = asFloat32(readAccessor(raw, buffers, sampler.input));
    const values = asFloat32(readAccessor(raw, buffers, sampler.output));
    duration = Math.max(duration, times[times.length - 1] ?? 0);
    channels.push({ node: channel.target.node, path, interpolation, times, values });
  }

  return {
    name: (animation['name'] as string | undefined) ?? `animation${index}`,
    channels,
    durationSeconds: duration,
  };
}

export function parseGltf(json: unknown, buffers: Uint8Array[]): GltfModel {
  const raw = json as RawGltf;
  const version = raw.asset?.version ?? '';
  if (!version.startsWith('2.')) throw new GltfSubsetError(`glTF 2.0 以外は非対応: "${version}"`);
  if (raw.extensionsRequired?.length) {
    throw new GltfSubsetError(`必須拡張は非対応: ${raw.extensionsRequired.join(', ')}`);
  }

  const nodes = (raw.nodes ?? []).map(parseNode);
  const meshes: GltfMesh[] = (raw.meshes ?? []).map((mesh, i) => ({
    name: (mesh['name'] as string | undefined) ?? `mesh${i}`,
    primitives: ((mesh['primitives'] ?? []) as Array<Record<string, unknown>>).map((prim) =>
      parsePrimitive(raw, buffers, prim),
    ),
  }));

  const skins: GltfSkin[] = (raw.skins ?? []).map((skin) => {
    const joints = (skin['joints'] as number[] | undefined) ?? [];
    const ibmIndex = skin['inverseBindMatrices'] as number | undefined;
    const inverseBindMatrices =
      ibmIndex === undefined ? new Float32Array(joints.length * 16) : asFloat32(readAccessor(raw, buffers, ibmIndex));
    return { joints: joints.slice(), inverseBindMatrices };
  });

  const animations = (raw.animations ?? []).map((a, i) => parseAnimation(raw, buffers, a, i));

  const images: GltfImage[] = (raw.images ?? []).map((image, i) => {
    if (image.uri?.startsWith('data:')) {
      const comma = image.uri.indexOf(',');
      const mime = image.uri.slice(5, image.uri.indexOf(';'));
      return { name: image.name ?? `image${i}`, uri: null, data: decodeBase64(image.uri.slice(comma + 1)), mimeType: mime };
    }
    if (image.bufferView !== undefined) {
      const view = raw.bufferViews?.[image.bufferView];
      const buffer = view ? buffers[view.buffer] : undefined;
      if (!view || !buffer) throw new GltfSubsetError(`image[${i}] の bufferView が壊れている`);
      const start = buffer.byteOffset + (view.byteOffset ?? 0);
      return {
        name: image.name ?? `image${i}`,
        uri: null,
        data: new Uint8Array(buffer.buffer, start, view.byteLength),
        mimeType: image.mimeType ?? 'image/png',
      };
    }
    return { name: image.name ?? `image${i}`, uri: image.uri ?? null, data: null, mimeType: image.mimeType ?? 'image/png' };
  });

  const materials: GltfMaterial[] = (raw.materials ?? []).map((material, i) => {
    const pbr = (material['pbrMetallicRoughness'] ?? {}) as {
      baseColorFactor?: Vec4;
      baseColorTexture?: { index: number; texCoord?: number };
    };
    let baseColorImage: number | null = null;
    if (pbr.baseColorTexture) {
      if ((pbr.baseColorTexture.texCoord ?? 0) !== 0) throw new GltfSubsetError('TEXCOORD_0 以外の参照は非対応');
      const texture = raw.textures?.[pbr.baseColorTexture.index];
      baseColorImage = texture?.source ?? null;
    }
    return {
      name: (material['name'] as string | undefined) ?? `material${i}`,
      baseColorFactor: (pbr.baseColorFactor ?? [1, 1, 1, 1]).slice() as Vec4,
      baseColorImage,
    };
  });

  const sceneIndex = raw.scene ?? 0;
  const roots = raw.scenes?.[sceneIndex]?.nodes ?? nodes.map((_, i) => i);

  return { nodes, roots: roots.slice(), meshes, skins, animations, materials, images };
}

const GLB_MAGIC = 0x46546c67;

/** .glb のチャンク分解 */
export function parseGlb(data: ArrayBuffer): { json: unknown; binary: Uint8Array | null } {
  const dv = new DataView(data);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new GltfSubsetError('GLB のマジックが一致しない');
  if (dv.getUint32(4, true) !== 2) throw new GltfSubsetError('GLB のバージョンが 2 ではない');

  let offset = 12;
  let json: unknown = null;
  let binary: Uint8Array | null = null;
  while (offset < dv.byteLength) {
    const chunkLength = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const body = new Uint8Array(data, offset + 8, chunkLength);
    if (chunkType === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    else if (chunkType === 0x004e4942) binary = body;
    offset += 8 + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }
  if (json === null) throw new GltfSubsetError('GLB に JSON チャンクが無い');
  return { json, binary };
}

export async function loadGltf(url: string, io: GltfIO = browserIO): Promise<GltfModel> {
  if (url.endsWith('.glb')) {
    const { json, binary } = parseGlb(await io.fetchBinary(url));
    const buffers = await loadBuffers(json as RawGltf, url, io, binary);
    return parseGltf(json, buffers);
  }
  const json = await io.fetchJson(url);
  const buffers = await loadBuffers(json as RawGltf, url, io, null);
  return parseGltf(json, buffers);
}

// --- ポーズとスキニング ------------------------------------------------------
//
// FC はボーンアニメを 6fps にコマ落ちさせる（GAME_PLAN §4）。
// そのためサンプリングは「任意の時刻を渡せる純粋関数」にしておき、
// 世代ごとの時間の量子化は呼び出し側（プロファイルの値）で行う。

/** ノードごとの TRS。アニメーションはこの配列だけを書き換える */
export interface Pose {
  translation: Float32Array; // 3 * nodes
  rotation: Float32Array; // 4 * nodes
  scale: Float32Array; // 3 * nodes
}

export function createPose(model: GltfModel): Pose {
  const count = model.nodes.length;
  const pose: Pose = {
    translation: new Float32Array(count * 3),
    rotation: new Float32Array(count * 4),
    scale: new Float32Array(count * 3),
  };
  resetPose(model, pose);
  return pose;
}

export function resetPose(model: GltfModel, pose: Pose): void {
  model.nodes.forEach((node, i) => {
    pose.translation.set(node.translation, i * 3);
    pose.rotation.set(node.rotation, i * 4);
    pose.scale.set(node.scale, i * 3);
  });
}

/** キーフレーム区間を二分探索する */
function findKeyframe(times: Float32Array, t: number): { index: number; alpha: number } {
  const last = times.length - 1;
  if (last < 0) return { index: 0, alpha: 0 };
  if (t <= (times[0] ?? 0)) return { index: 0, alpha: 0 };
  if (t >= (times[last] ?? 0)) return { index: last, alpha: 0 };

  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if ((times[mid] ?? 0) <= t) low = mid;
    else high = mid;
  }
  const t0 = times[low] ?? 0;
  const t1 = times[high] ?? t0;
  const span = t1 - t0;
  return { index: low, alpha: span > 0 ? (t - t0) / span : 0 };
}

function slerp(out: Float32Array, outOffset: number, a: Float32Array, ai: number, b: Float32Array, bi: number, t: number): void {
  let ax = a[ai] ?? 0, ay = a[ai + 1] ?? 0, az = a[ai + 2] ?? 0, aw = a[ai + 3] ?? 1;
  const bx = b[bi] ?? 0, by = b[bi + 1] ?? 0, bz = b[bi + 2] ?? 0, bw = b[bi + 3] ?? 1;
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) {
    cos = -cos;
    ax = -ax; ay = -ay; az = -az; aw = -aw;
  }
  let s0 = 1 - t;
  let s1 = t;
  if (cos < 0.9995) {
    const theta = Math.acos(cos);
    const sinTheta = Math.sin(theta);
    s0 = Math.sin((1 - t) * theta) / sinTheta;
    s1 = Math.sin(t * theta) / sinTheta;
  }
  out[outOffset] = s0 * ax + s1 * bx;
  out[outOffset + 1] = s0 * ay + s1 * by;
  out[outOffset + 2] = s0 * az + s1 * bz;
  out[outOffset + 3] = s0 * aw + s1 * bw;
}

/**
 * アニメーションを時刻 t（秒）でサンプリングして pose を更新する。
 * 決定的な純粋関数であり、実時間には依存しない（不変条件 I4）。
 */
export function sampleAnimation(animation: GltfAnimation, timeSeconds: number, pose: Pose, loop = true): void {
  const duration = animation.durationSeconds;
  const t = loop && duration > 0 ? timeSeconds % duration : Math.min(timeSeconds, duration);

  for (const channel of animation.channels) {
    const stride = channel.path === 'rotation' ? 4 : 3;
    const { index, alpha } = findKeyframe(channel.times, t);
    const next = Math.min(index + 1, channel.times.length - 1);
    const target =
      channel.path === 'translation' ? pose.translation : channel.path === 'scale' ? pose.scale : pose.rotation;
    const outOffset = channel.node * stride;
    const a = index * stride;
    const b = next * stride;

    if (channel.interpolation === 'STEP' || alpha === 0) {
      for (let c = 0; c < stride; c++) target[outOffset + c] = channel.values[a + c] ?? 0;
      continue;
    }
    if (channel.path === 'rotation') {
      slerp(target, outOffset, channel.values, a, channel.values, b, alpha);
      continue;
    }
    for (let c = 0; c < stride; c++) {
      const v0 = channel.values[a + c] ?? 0;
      const v1 = channel.values[b + c] ?? 0;
      target[outOffset + c] = v0 + (v1 - v0) * alpha;
    }
  }
}

function composeTRS(out: Float32Array, offset: number, pose: Pose, node: number): void {
  const tx = pose.translation[node * 3] ?? 0;
  const ty = pose.translation[node * 3 + 1] ?? 0;
  const tz = pose.translation[node * 3 + 2] ?? 0;
  const x = pose.rotation[node * 4] ?? 0;
  const y = pose.rotation[node * 4 + 1] ?? 0;
  const z = pose.rotation[node * 4 + 2] ?? 0;
  const w = pose.rotation[node * 4 + 3] ?? 1;
  const sx = pose.scale[node * 3] ?? 1;
  const sy = pose.scale[node * 3 + 1] ?? 1;
  const sz = pose.scale[node * 3 + 2] ?? 1;

  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;

  out[offset] = (1 - (yy + zz)) * sx;
  out[offset + 1] = (xy + wz) * sx;
  out[offset + 2] = (xz - wy) * sx;
  out[offset + 3] = 0;
  out[offset + 4] = (xy - wz) * sy;
  out[offset + 5] = (1 - (xx + zz)) * sy;
  out[offset + 6] = (yz + wx) * sy;
  out[offset + 7] = 0;
  out[offset + 8] = (xz + wy) * sz;
  out[offset + 9] = (yz - wx) * sz;
  out[offset + 10] = (1 - (xx + yy)) * sz;
  out[offset + 11] = 0;
  out[offset + 12] = tx;
  out[offset + 13] = ty;
  out[offset + 14] = tz;
  out[offset + 15] = 1;
}

function multiply(out: Float32Array, o: number, a: Float32Array, ao: number, b: Float32Array, bo: number): void {
  for (let col = 0; col < 4; col++) {
    const b0 = b[bo + col * 4] ?? 0;
    const b1 = b[bo + col * 4 + 1] ?? 0;
    const b2 = b[bo + col * 4 + 2] ?? 0;
    const b3 = b[bo + col * 4 + 3] ?? 0;
    for (let row = 0; row < 4; row++) {
      out[o + col * 4 + row] =
        (a[ao + row] ?? 0) * b0 +
        (a[ao + 4 + row] ?? 0) * b1 +
        (a[ao + 8 + row] ?? 0) * b2 +
        (a[ao + 12 + row] ?? 0) * b3;
    }
  }
}

/**
 * ノードのワールド行列を階層順に計算する。
 * @param out 16 * nodes の Float32Array（呼び出し側が使い回す。毎フレーム確保しない）
 */
export function computeGlobalMatrices(model: GltfModel, pose: Pose, out: Float32Array): void {
  const local = new Float32Array(16);
  const visit = (nodeIndex: number, parentOffset: number | null): void => {
    composeTRS(local, 0, pose, nodeIndex);
    const offset = nodeIndex * 16;
    if (parentOffset === null) out.set(local, offset);
    else multiply(out, offset, out, parentOffset, local, 0);
    for (const child of model.nodes[nodeIndex]?.children ?? []) visit(child, offset);
  };
  for (const root of model.roots) visit(root, null);
}

/**
 * スキンのジョイント行列（ワールド行列 × 逆バインド行列）を求める。
 * 頂点シェーダへそのまま渡せる 16 * joints の配列。
 */
export function computeJointMatrices(
  model: GltfModel,
  skinIndex: number,
  globals: Float32Array,
  out: Float32Array,
): void {
  const skin = model.skins[skinIndex];
  if (!skin) throw new GltfSubsetError(`skin[${skinIndex}] が無い`);
  skin.joints.forEach((joint, i) => {
    multiply(out, i * 16, globals, joint * 16, skin.inverseBindMatrices, i * 16);
  });
}
