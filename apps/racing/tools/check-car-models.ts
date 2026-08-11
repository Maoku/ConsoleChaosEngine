import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadGltf, type GltfIO } from '@console-chaos/engine';
import { geometryStats, pngDimensions, readGlb, sha256 } from './car-model-tools';

const ROOT = resolve(import.meta.dirname, '../../..');
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'apps/racing/public/assets/car-conversion.json'), 'utf8')) as {
  version: number;
  records: Array<{
    generation: 'PS1' | 'PS2';
    source: { path: string; sha256: string; bytes: number };
    runtime: {
      model: { path: string; sha256: string; bytes: number };
      texture: { path: string; sha256: string; bytes: number; dimensions: [number, number] };
    };
    geometry: { fingerprint: string; triangles: number; vertices: number; bounds: unknown };
    frontAxis: '-X';
  }>;
};

if (manifest.version !== 1 || manifest.records.length !== 2) throw new Error('unexpected car conversion manifest');
for (const record of manifest.records) {
  const sourcePath = resolve(ROOT, record.source.path);
  const modelPath = resolve(ROOT, record.runtime.model.path);
  const texturePath = resolve(ROOT, record.runtime.texture.path);
  const sourceBytes = readFileSync(sourcePath);
  const runtimeBytes = readFileSync(modelPath);
  const textureBytes = readFileSync(texturePath);
  if (sha256(sourceBytes) !== record.source.sha256) throw new Error(`${record.generation}: source hash mismatch`);
  if (sha256(runtimeBytes) !== record.runtime.model.sha256) throw new Error(`${record.generation}: runtime model hash mismatch`);
  if (sha256(textureBytes) !== record.runtime.texture.sha256) throw new Error(`${record.generation}: texture hash mismatch`);
  const sourceStats = geometryStats(readGlb(sourcePath));
  const runtimeDocument = readGlb(modelPath);
  const runtimeStats = geometryStats(runtimeDocument);
  if (sourceStats.fingerprint !== runtimeStats.fingerprint || runtimeStats.fingerprint !== record.geometry.fingerprint) {
    throw new Error(`${record.generation}: canonical geometry fingerprint mismatch`);
  }
  if (sourceStats.triangles !== runtimeStats.triangles || runtimeStats.triangles !== record.geometry.triangles) {
    throw new Error(`${record.generation}: triangle count mismatch`);
  }
  if (runtimeDocument.json.images || runtimeDocument.json.materials || runtimeDocument.json.textures) {
    throw new Error(`${record.generation}: runtime GLB still contains material images`);
  }
  if (runtimeDocument.json.nodes?.some((node) => node['matrix'] !== undefined)) {
    throw new Error(`${record.generation}: runtime GLB contains node.matrix`);
  }
  const dimensions = pngDimensions(texturePath);
  if (dimensions[0] !== record.runtime.texture.dimensions[0] || dimensions[1] !== record.runtime.texture.dimensions[1]) {
    throw new Error(`${record.generation}: texture dimensions mismatch`);
  }
  const modelBudget = record.generation === 'PS1' ? 256_000 : 2_000_000;
  const textureBudget = record.generation === 'PS1' ? 512_000 : 5_000_000;
  if (statSync(modelPath).size > modelBudget || statSync(texturePath).size > textureBudget) {
    throw new Error(`${record.generation}: runtime asset budget exceeded`);
  }
  const io: GltfIO = {
    fetchJson: async () => { throw new Error('runtime car is a GLB'); },
    fetchBinary: async () => runtimeBytes.buffer.slice(runtimeBytes.byteOffset, runtimeBytes.byteOffset + runtimeBytes.byteLength),
  };
  const loaded = await loadGltf(record.runtime.model.path, io);
  const loadedTriangles = loaded.meshes.flatMap((mesh) => mesh.primitives)
    .reduce((sum, primitive) => sum + primitive.indices.length / 3, 0);
  if (loadedTriangles !== record.geometry.triangles) throw new Error(`${record.generation}: Engine loader triangle mismatch`);
  console.log(`✓ ${record.generation}: ${loadedTriangles} triangles, fingerprint ${runtimeStats.fingerprint.slice(0, 12)}, Engine loader pass`);
}

const environmentPath = resolve(ROOT, 'apps/racing/public/assets/gen4/environment/circuit.png');
const environmentBytes = readFileSync(environmentPath);
const environmentDimensions = pngDimensions(environmentPath);
if (environmentDimensions[0] !== 1024 || environmentDimensions[1] !== 512) {
  throw new Error(`PS2 environment must be a 1024x512 equirectangular texture, got ${environmentDimensions.join('x')}`);
}
if (environmentBytes.byteLength > 1_000_000) throw new Error('PS2 environment exceeds the 1 MB runtime budget');
const hasColorProfile = environmentBytes.includes(Buffer.from('iCCP')) || environmentBytes.includes(Buffer.from('sRGB'));
if (!hasColorProfile) throw new Error('PS2 environment PNG does not declare an RGB color profile');
console.log(`✓ PS2 environment: ${environmentDimensions.join('x')}, ${environmentBytes.byteLength} bytes, RGB profile present`);
