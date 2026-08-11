/**
 * アセットがローダのサブセット範囲に収まっているかの検査（T0-07、§7.3）。
 *
 * 実際のローダ（src/render/loader/gltf.ts）にそのまま通すため、
 * 「CI は通ったが実行時に落ちる」が起きない。加えて Docs/asset-rules.md の
 * 数値制約（ジョイント数・ウェイト正規化・命名）を検査する。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { computeGlobalMatrices, createPose, loadGltf, type GltfIO, type GltfModel } from '../src/render/loader/gltf';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_DIR = join(ROOT, 'public/assets/models');

/** Docs/asset-rules.md §5 の上限（シェーダの uJoints[24] に合わせる） */
const MAX_JOINTS = 24;
const WEIGHT_TOLERANCE = 0.01;

const io: GltfIO = {
  async fetchJson(url) {
    return JSON.parse(readFileSync(url, 'utf8'));
  },
  async fetchBinary(url) {
    const buf = readFileSync(url);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  },
};

const errors: string[] = [];

function checkNaming(file: string): void {
  if (!/^[a-z0-9_]+\.(gltf|glb)$/.test(basename(file))) {
    errors.push(`${file}: ファイル名は小文字スネークケースにする（asset-rules.md §2）`);
  }
}

/**
 * プロップは **[-1, 1] の単位箱**で作る（`render/renderer3d.ts` はこれを前提に
 * `halfExtents` を掛ける）。ここが崩れると**絵だけが当たり判定からずれる**。
 *
 * 検査はノード変換を掛けた後の座標で行う。掛けずに見ると、
 * 「メッシュがずれている × ノードで戻している」正しいアセットを誤検出する
 *（逆に、描画側がノード変換を落としていた不具合が T1-29 まで残った）。
 */
const UNIT_BOX_TOLERANCE = 0.05;

function checkUnitBox(file: string, model: GltfModel): void {
  const globals = new Float32Array(model.nodes.length * 16);
  computeGlobalMatrices(model, createPose(model), globals);
  const limit = 1 + UNIT_BOX_TOLERANCE;

  model.nodes.forEach((node, index) => {
    if (node.mesh === null) return;
    const offset = index * 16;
    for (const primitive of model.meshes[node.mesh]?.primitives ?? []) {
      for (let v = 0; v < primitive.positions.length; v += 3) {
        for (let axis = 0; axis < 3; axis++) {
          // 平行移動・回転・拡大縮小をまとめて掛ける（列優先の 4x4）
          const value =
            (globals[offset + axis] ?? 0) * (primitive.positions[v] ?? 0) +
            (globals[offset + 4 + axis] ?? 0) * (primitive.positions[v + 1] ?? 0) +
            (globals[offset + 8 + axis] ?? 0) * (primitive.positions[v + 2] ?? 0) +
            (globals[offset + 12 + axis] ?? 0);
          if (Math.abs(value) > limit) {
            errors.push(
              `${file}: node[${index}] の頂点が単位箱をはみ出す（軸 ${axis} = ${value.toFixed(3)}）。` +
                'プロップは [-1, 1] で作る（asset-rules.md §3）',
            );
            return;
          }
        }
      }
    }
  });
}

function checkModel(file: string, model: GltfModel): void {
  for (const [i, skin] of model.skins.entries()) {
    if (skin.joints.length > MAX_JOINTS) {
      errors.push(`${file}: skin[${i}] のジョイント数 ${skin.joints.length} > 上限 ${MAX_JOINTS}`);
    }
  }

  for (const [mi, mesh] of model.meshes.entries()) {
    for (const [pi, prim] of mesh.primitives.entries()) {
      const where = `${file}: mesh[${mi}].primitive[${pi}]`;
      if (prim.weights) {
        const count = prim.weights.length / 4;
        for (let v = 0; v < count; v++) {
          const sum =
            (prim.weights[v * 4] ?? 0) +
            (prim.weights[v * 4 + 1] ?? 0) +
            (prim.weights[v * 4 + 2] ?? 0) +
            (prim.weights[v * 4 + 3] ?? 0);
          if (Math.abs(sum - 1) > WEIGHT_TOLERANCE) {
            errors.push(`${where}: 頂点 ${v} のウェイト合計が ${sum.toFixed(3)}（1.0 に正規化する）`);
            break;
          }
        }
      }
      if (prim.joints && !prim.weights) {
        errors.push(`${where}: JOINTS_0 があるのに WEIGHTS_0 が無い`);
      }
      if (prim.indices.length % 3 !== 0) {
        errors.push(`${where}: インデックス数が 3 の倍数ではない`);
      }
    }
  }

  for (const animation of model.animations) {
    for (const channel of animation.channels) {
      if (channel.times.length !== channel.values.length / (channel.path === 'rotation' ? 4 : 3)) {
        errors.push(`${file}: animation "${animation.name}" のキー数と値の数が一致しない`);
      }
    }
  }
}

async function main(): Promise<void> {
  if (!existsSync(MODEL_DIR)) {
    console.log('✓ アセット検査: models ディレクトリ未作成（検査対象 0 件）');
    return;
  }
  const files = readdirSync(MODEL_DIR).filter((f) => f.endsWith('.gltf') || f.endsWith('.glb'));

  for (const file of files) {
    checkNaming(file);
    try {
      const model = await loadGltf(join(MODEL_DIR, file), io);
      checkModel(file, model);
      // 単位箱の約束はプロップだけのもの（プレイヤーは足元原点で作る）
      if (file.startsWith('props_')) checkUnitBox(file, model);
      const triangles = model.meshes.reduce(
        (sum, mesh) => sum + mesh.primitives.reduce((s, p) => s + p.indices.length / 3, 0),
        0,
      );
      console.log(
        `  ✓ ${file}  三角形 ${triangles} / ノード ${model.nodes.length} / スキン ${model.skins.length} / アニメ ${model.animations.length}`,
      );
    } catch (e) {
      errors.push(`${file}: ${(e as Error).message}`);
    }
  }

  if (errors.length > 0) {
    console.error('✗ サブセット範囲外のアセットを検出');
    for (const error of errors) console.error(`  ${error}`);
    console.error('\n対応範囲は Docs/asset-rules.md を参照');
    process.exit(1);
  }
  console.log(`✓ アセット検査: ${files.length} 件すべてがサブセット範囲内`);
}

await main();
