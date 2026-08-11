/**
 * T0-06 のテストモデル生成。
 *
 * 本来は Blender からエクスポートしたモデルで検証するが、
 * 「ローダのサブセット範囲を外れていないこと」を CI で回し続けるには、
 * 生成規則が明文化された固定のテストモデルが要る。
 * ここで作る test_skinned.gltf は、Blender 出力と同じ構造
 *（TRS ノード / JOINTS_0 / WEIGHTS_0 / inverseBindMatrices / LINEAR の回転アニメ）
 * を持つ最小のスキンメッシュ。
 *
 *   bone1 (y=1) ← 回転アニメ
 *     |
 *   bone0 (y=0)
 *
 * 縦に 3 段の帯（頂点 6、三角形 4）を 2 ボーンで曲げる。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/assets/models/test_skinned.gltf');

// 頂点: (x, y, z)。3 段 × 2 列
const positions = new Float32Array([
  -0.5, 0, 0, 0.5, 0, 0,
  -0.5, 1, 0, 0.5, 1, 0,
  -0.5, 2, 0, 0.5, 2, 0,
]);
const normals = new Float32Array([
  0, 0, 1, 0, 0, 1,
  0, 0, 1, 0, 0, 1,
  0, 0, 1, 0, 0, 1,
]);
const uvs = new Float32Array([
  0, 1, 1, 1,
  0, 0.5, 1, 0.5,
  0, 0, 1, 0,
]);
// 下段は bone0、中段は半々、上段は bone1
const joints = new Uint16Array([
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 1, 0, 0, 0, 1, 0, 0,
  1, 0, 0, 0, 1, 0, 0, 0,
]);
const weights = new Float32Array([
  1, 0, 0, 0, 1, 0, 0, 0,
  0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0,
  1, 0, 0, 0, 1, 0, 0, 0,
]);
const indices = new Uint16Array([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]);

// 逆バインド行列（列優先）。bone0 は単位行列、bone1 は translate(0, -1, 0)
const inverseBind = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1,
]);

// アニメーション: bone1 を Z 軸まわりに 0 → 90 度 → 0
const times = new Float32Array([0, 0.5, 1]);
const s = Math.SQRT1_2; // sin(45°) = cos(45°)
const rotations = new Float32Array([
  0, 0, 0, 1,
  0, 0, s, s,
  0, 0, 0, 1,
]);

interface Chunk {
  data: ArrayBufferView;
  byteOffset: number;
}

const chunks: Chunk[] = [];
let cursor = 0;
function push(data: ArrayBufferView): number {
  // 4 バイト境界に揃える（glTF の要求）
  const pad = (4 - (cursor % 4)) % 4;
  cursor += pad;
  const byteOffset = cursor;
  chunks.push({ data, byteOffset });
  cursor += data.byteLength;
  return byteOffset;
}

const offsets = {
  positions: push(positions),
  normals: push(normals),
  uvs: push(uvs),
  joints: push(joints),
  weights: push(weights),
  indices: push(indices),
  inverseBind: push(inverseBind),
  times: push(times),
  rotations: push(rotations),
};

const buffer = new Uint8Array(cursor);
for (const chunk of chunks) {
  buffer.set(
    new Uint8Array(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength),
    chunk.byteOffset,
  );
}

const gltf = {
  asset: { version: '2.0', generator: 'tools/make-test-gltf.ts' },
  scene: 0,
  scenes: [{ nodes: [0, 1] }],
  nodes: [
    { name: 'strip', mesh: 0, skin: 0 },
    { name: 'bone0', translation: [0, 0, 0], children: [2] },
    { name: 'bone1', translation: [0, 1, 0] },
  ],
  meshes: [
    {
      name: 'strip',
      primitives: [
        {
          attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, JOINTS_0: 3, WEIGHTS_0: 4 },
          indices: 5,
          material: 0,
          mode: 4,
        },
      ],
    },
  ],
  skins: [{ inverseBindMatrices: 6, joints: [1, 2], skeleton: 1 }],
  animations: [
    {
      name: 'bend',
      samplers: [{ input: 7, output: 8, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }],
    },
  ],
  materials: [
    {
      name: 'flat',
      pbrMetallicRoughness: { baseColorFactor: [0.9, 0.4, 0.2, 1] },
    },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 6, type: 'VEC3', min: [-0.5, 0, 0], max: [0.5, 2, 0] },
    { bufferView: 1, componentType: 5126, count: 6, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: 6, type: 'VEC2' },
    { bufferView: 3, componentType: 5123, count: 6, type: 'VEC4' },
    { bufferView: 4, componentType: 5126, count: 6, type: 'VEC4' },
    { bufferView: 5, componentType: 5123, count: 12, type: 'SCALAR' },
    { bufferView: 6, componentType: 5126, count: 2, type: 'MAT4' },
    { bufferView: 7, componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [1] },
    { bufferView: 8, componentType: 5126, count: 3, type: 'VEC4' },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: offsets.positions, byteLength: positions.byteLength },
    { buffer: 0, byteOffset: offsets.normals, byteLength: normals.byteLength },
    { buffer: 0, byteOffset: offsets.uvs, byteLength: uvs.byteLength },
    { buffer: 0, byteOffset: offsets.joints, byteLength: joints.byteLength },
    { buffer: 0, byteOffset: offsets.weights, byteLength: weights.byteLength },
    { buffer: 0, byteOffset: offsets.indices, byteLength: indices.byteLength },
    { buffer: 0, byteOffset: offsets.inverseBind, byteLength: inverseBind.byteLength },
    { buffer: 0, byteOffset: offsets.times, byteLength: times.byteLength },
    { buffer: 0, byteOffset: offsets.rotations, byteLength: rotations.byteLength },
  ],
  buffers: [
    {
      byteLength: buffer.byteLength,
      uri: `data:application/octet-stream;base64,${Buffer.from(buffer).toString('base64')}`,
    },
  ],
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(gltf, null, 2)}\n`);
console.log(`✓ テストモデルを生成: ${OUT} (${buffer.byteLength} バイト)`);
