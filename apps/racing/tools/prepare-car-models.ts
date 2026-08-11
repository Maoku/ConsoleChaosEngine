import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import {
  buildRuntimeGlb,
  extractBaseColor,
  geometryStats,
  pngDimensions,
  readGlb,
  sha256,
  writeGlb,
} from './car-model-tools';

const ROOT = resolve(import.meta.dirname, '../../..');

const SPECS = [
  {
    generation: 'PS1',
    source: 'apps/racing/data/gen3_car.glb',
    sourceSha256: '5e48569c625a00cf549069be7eb90b9bd6e87b23164bb92ad06480ee84a76c2e',
    model: 'apps/racing/public/assets/gen3/models/car.glb',
    texture: 'apps/racing/public/assets/gen3/textures/car_base_color.png',
    textureSize: 256,
    triangles: 978,
  },
  {
    generation: 'PS2',
    source: 'apps/racing/data/gen4_car.glb',
    sourceSha256: 'b00d08a2f81790a39bdd8fb6f5c2214cb0bf0b15a1c61edc033fbb00de846c94',
    model: 'apps/racing/public/assets/gen4/models/car.glb',
    texture: 'apps/racing/public/assets/gen4/textures/car_base_color.png',
    textureSize: 1024,
    triangles: 13618,
  },
] as const;

const temporary = mkdtempSync(join(tmpdir(), 'console-chaos-racing-cars-'));
const records = [];
try {
  for (const spec of SPECS) {
    const sourcePath = resolve(ROOT, spec.source);
    const modelPath = resolve(ROOT, spec.model);
    const texturePath = resolve(ROOT, spec.texture);
    const sourceBytes = readFileSync(sourcePath);
    const sourceHash = sha256(sourceBytes);
    if (sourceHash !== spec.sourceSha256) throw new Error(`${spec.source}: source SHA-256 changed`);
    const source = readGlb(sourcePath);
    const sourceGeometry = geometryStats(source);
    if (sourceGeometry.triangles !== spec.triangles) throw new Error(`${spec.source}: triangle count changed`);

    const runtime = buildRuntimeGlb(source);
    const runtimeGeometry = geometryStats(runtime);
    if (runtimeGeometry.fingerprint !== sourceGeometry.fingerprint) throw new Error(`${spec.source}: geometry fingerprint changed`);
    mkdirSync(dirname(modelPath), { recursive: true });
    mkdirSync(dirname(texturePath), { recursive: true });
    writeGlb(modelPath, runtime);

    const baseColor = extractBaseColor(source);
    const extracted = join(temporary, `${spec.generation.toLowerCase()}${baseColor.extension}`);
    writeFileSync(extracted, baseColor.data);
    execFileSync('sips', [
      '-z', String(spec.textureSize), String(spec.textureSize),
      '-s', 'format', 'png',
      extracted,
      '--out', texturePath,
    ], { stdio: 'ignore' });
    const dimensions = pngDimensions(texturePath);
    if (dimensions[0] !== spec.textureSize || dimensions[1] !== spec.textureSize) {
      throw new Error(`${spec.texture}: output dimensions are ${dimensions.join('x')}`);
    }

    const modelBytes = readFileSync(modelPath);
    const textureBytes = readFileSync(texturePath);
    records.push({
      generation: spec.generation,
      source: { path: spec.source, sha256: sourceHash, bytes: sourceBytes.byteLength },
      runtime: {
        model: { path: spec.model, sha256: sha256(modelBytes), bytes: modelBytes.byteLength },
        texture: {
          path: spec.texture,
          sha256: sha256(textureBytes),
          bytes: textureBytes.byteLength,
          dimensions,
        },
      },
      geometry: sourceGeometry,
      frontAxis: '-X',
    });
    console.log(`✓ ${spec.generation}: ${sourceGeometry.triangles} triangles, ${modelBytes.byteLength} byte GLB, ${dimensions.join('x')} texture`);
  }
  const manifestPath = resolve(ROOT, 'apps/racing/public/assets/car-conversion.json');
  writeFileSync(manifestPath, `${JSON.stringify({ version: 1, records }, null, 2)}\n`);
  console.log(`✓ ${relative(ROOT, manifestPath)}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
