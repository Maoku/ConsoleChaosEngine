import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export interface RawAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4';
  min?: number[];
  max?: number[];
}

export interface RawBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
}

export interface RawPrimitive {
  attributes: Record<string, number>;
  indices: number;
  material?: number;
  mode?: number;
}

export interface RawGltf {
  asset: Record<string, unknown>;
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<Record<string, unknown>>;
  meshes: Array<{ name?: string; primitives: RawPrimitive[] }>;
  accessors: RawAccessor[];
  bufferViews: RawBufferView[];
  buffers: Array<{ byteLength: number }>;
  materials?: Array<Record<string, unknown>>;
  textures?: Array<{ source?: number }>;
  images?: Array<{ name?: string; bufferView?: number; mimeType?: string }>;
  [key: string]: unknown;
}

export interface GlbDocument {
  json: RawGltf;
  binary: Buffer;
}

export interface GeometryStats {
  fingerprint: string;
  triangles: number;
  vertices: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
}

const COMPONENT_BYTES: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<RawAccessor['type'], number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function readGlb(path: string): GlbDocument {
  const source = readFileSync(path);
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error(`${path}: expected a glTF 2.0 GLB`);
  }
  let offset = 12;
  let json: RawGltf | null = null;
  let binary: Buffer | null = null;
  while (offset < source.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = source.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8')) as RawGltf;
    if (type === 0x004e4942) binary = Buffer.from(chunk);
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error(`${path}: missing JSON or BIN chunk`);
  return { json, binary };
}

function componentAt(document: GlbDocument, accessorIndex: number, element: number, component: number): number {
  const accessor = document.json.accessors[accessorIndex];
  if (!accessor) throw new Error(`accessor[${accessorIndex}] is missing`);
  const bufferView = document.json.bufferViews[accessor.bufferView];
  if (!bufferView) throw new Error(`bufferView[${accessor.bufferView}] is missing`);
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  if (!componentBytes) throw new Error(`unsupported componentType ${accessor.componentType}`);
  const components = TYPE_COMPONENTS[accessor.type];
  const stride = bufferView.byteStride ?? components * componentBytes;
  const offset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + element * stride + component * componentBytes;
  switch (accessor.componentType) {
    case 5121: return document.binary.readUInt8(offset);
    case 5123: return document.binary.readUInt16LE(offset);
    case 5125: return document.binary.readUInt32LE(offset);
    case 5126: return document.binary.readFloatLE(offset);
    default: throw new Error(`unsupported componentType ${accessor.componentType}`);
  }
}

function updateFloat(hash: ReturnType<typeof createHash>, scratch: Buffer, value: number): void {
  scratch.writeFloatLE(value, 0);
  hash.update(scratch);
}

function updateUint(hash: ReturnType<typeof createHash>, scratch: Buffer, value: number): void {
  scratch.writeUInt32LE(value, 0);
  hash.update(scratch);
}

export function geometryStats(document: GlbDocument): GeometryStats {
  const hash = createHash('sha256');
  const scratch = Buffer.allocUnsafe(4);
  const minimum: [number, number, number] = [Infinity, Infinity, Infinity];
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  let vertices = 0;
  for (const [meshIndex, mesh] of document.json.meshes.entries()) {
    for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
      hash.update(`mesh:${meshIndex}:primitive:${primitiveIndex}\0`);
      for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0'] as const) {
        const accessorIndex = primitive.attributes[semantic];
        if (accessorIndex === undefined) throw new Error(`${semantic} is required for the Racing runtime model`);
        const accessor = document.json.accessors[accessorIndex];
        if (!accessor || accessor.componentType !== 5126) throw new Error(`${semantic} must use FLOAT components`);
        const components = TYPE_COMPONENTS[accessor.type];
        hash.update(`${semantic}:${accessor.count}:${components}\0`);
        for (let element = 0; element < accessor.count; element++) {
          for (let component = 0; component < components; component++) {
            const value = componentAt(document, accessorIndex, element, component);
            updateFloat(hash, scratch, value);
            if (semantic === 'POSITION' && component < 3) {
              minimum[component] = Math.min(minimum[component], value);
              maximum[component] = Math.max(maximum[component], value);
            }
          }
        }
        if (semantic === 'POSITION') vertices += accessor.count;
      }
      const indices = document.json.accessors[primitive.indices];
      if (!indices || indices.type !== 'SCALAR') throw new Error('indices must use a SCALAR accessor');
      hash.update(`INDICES:${indices.count}\0`);
      for (let index = 0; index < indices.count; index++) {
        updateUint(hash, scratch, componentAt(document, primitive.indices, index, 0));
      }
      triangles += indices.count / 3;
    }
  }
  return {
    fingerprint: hash.digest('hex'),
    triangles,
    vertices,
    bounds: {
      min: minimum,
      max: maximum,
      size: [maximum[0] - minimum[0], maximum[1] - minimum[1], maximum[2] - minimum[2]],
    },
  };
}

function align4(value: number): number {
  return value + ((4 - value % 4) % 4);
}

function normalizeNodes(nodes: Array<Record<string, unknown>> | undefined): Array<Record<string, unknown>> {
  return (nodes ?? []).map((source, index) => {
    const node = structuredClone(source);
    const matrix = node['matrix'];
    if (matrix !== undefined) {
      if (!Array.isArray(matrix) || matrix.length !== 16 || matrix.some((value, slot) => Math.abs(Number(value) - IDENTITY_MATRIX[slot]!) > 1e-8)) {
        throw new Error(`node[${index}] has a non-identity matrix`);
      }
      delete node['matrix'];
    }
    delete node['skin'];
    return node;
  });
}

export function buildRuntimeGlb(source: GlbDocument): GlbDocument {
  const viewMap = new Map<number, number>();
  const accessorMap = new Map<number, number>();
  const newViews: RawBufferView[] = [];
  const chunks: Buffer[] = [];
  let binaryLength = 0;

  const copyView = (sourceIndex: number): number => {
    const existing = viewMap.get(sourceIndex);
    if (existing !== undefined) return existing;
    const view = source.json.bufferViews[sourceIndex];
    if (!view) throw new Error(`bufferView[${sourceIndex}] is missing`);
    const aligned = align4(binaryLength);
    if (aligned > binaryLength) chunks.push(Buffer.alloc(aligned - binaryLength));
    const start = view.byteOffset ?? 0;
    chunks.push(Buffer.from(source.binary.subarray(start, start + view.byteLength)));
    const target = newViews.length;
    newViews.push({ ...view, buffer: 0, byteOffset: aligned });
    viewMap.set(sourceIndex, target);
    binaryLength = aligned + view.byteLength;
    return target;
  };

  const copyAccessor = (sourceIndex: number): number => {
    const existing = accessorMap.get(sourceIndex);
    if (existing !== undefined) return existing;
    const accessor = source.json.accessors[sourceIndex];
    if (!accessor) throw new Error(`accessor[${sourceIndex}] is missing`);
    const target = accessorMap.size;
    accessorMap.set(sourceIndex, target);
    return target;
  };

  const meshes = source.json.meshes.map((mesh) => ({
    ...(mesh.name ? { name: mesh.name } : {}),
    primitives: mesh.primitives.map((primitive) => {
      const attributes: Record<string, number> = {};
      for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
        const index = primitive.attributes[semantic];
        if (index === undefined) throw new Error(`${semantic} is missing`);
        attributes[semantic] = copyAccessor(index);
      }
      return { attributes, indices: copyAccessor(primitive.indices), mode: 4 };
    }),
  }));

  const accessors = [...accessorMap.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([sourceIndex]) => {
      const accessor = structuredClone(source.json.accessors[sourceIndex]!);
      accessor.bufferView = copyView(accessor.bufferView);
      return accessor;
    });
  const binary = Buffer.concat(chunks, align4(binaryLength));
  const json: RawGltf = {
    asset: { version: '2.0', generator: 'Console Chaos Racing deterministic car converter' },
    scene: source.json.scene ?? 0,
    scenes: structuredClone(source.json.scenes ?? [{ nodes: [0] }]),
    nodes: normalizeNodes(source.json.nodes),
    meshes,
    accessors,
    bufferViews: newViews,
    buffers: [{ byteLength: binaryLength }],
  };
  return { json, binary };
}

export function writeGlb(path: string, document: GlbDocument): void {
  const jsonSource = Buffer.from(JSON.stringify(document.json));
  const jsonLength = align4(jsonSource.length);
  const binaryLength = align4(document.binary.length);
  const output = Buffer.alloc(12 + 8 + jsonLength + 8 + binaryLength);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonLength, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonSource.copy(output, 20);
  output.fill(0x20, 20 + jsonSource.length, 20 + jsonLength);
  const binaryHeader = 20 + jsonLength;
  output.writeUInt32LE(binaryLength, binaryHeader);
  output.writeUInt32LE(0x004e4942, binaryHeader + 4);
  document.binary.copy(output, binaryHeader + 8);
  writeFileSync(path, output);
}

export function extractBaseColor(document: GlbDocument): { data: Buffer; extension: '.png' | '.jpg' } {
  const material = document.json.materials?.[0];
  const pbr = material?.['pbrMetallicRoughness'] as { baseColorTexture?: { index?: number } } | undefined;
  const textureIndex = pbr?.baseColorTexture?.index;
  const imageIndex = textureIndex === undefined ? undefined : document.json.textures?.[textureIndex]?.source;
  const image = imageIndex === undefined ? undefined : document.json.images?.[imageIndex];
  if (!image || image.bufferView === undefined) throw new Error('embedded base-color image is missing');
  const view = document.json.bufferViews[image.bufferView];
  if (!view) throw new Error(`base-color bufferView[${image.bufferView}] is missing`);
  const start = view.byteOffset ?? 0;
  const extension = image.mimeType === 'image/png' ? '.png' : '.jpg';
  return { data: Buffer.from(document.binary.subarray(start, start + view.byteLength)), extension };
}

export function pngDimensions(path: string): readonly [number, number] {
  const data = readFileSync(path);
  if (data.readUInt32BE(0) !== 0x89504e47 || data.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${path}: expected PNG output`);
  }
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}
