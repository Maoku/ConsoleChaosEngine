import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  GltfSubsetError,
  computeGlobalMatrices,
  computeJointMatrices,
  createPose,
  loadGltf,
  parseGltf,
  sampleAnimation,
  type GltfIO,
  type GltfModel,
} from '@console-chaos/engine';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MODEL_PATH = join(ROOT, 'public/assets/models/test_skinned.gltf');

const io: GltfIO = {
  async fetchJson(url) {
    return JSON.parse(readFileSync(url, 'utf8'));
  },
  async fetchBinary(url) {
    const buf = readFileSync(url);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  },
};

async function load(): Promise<GltfModel> {
  return loadGltf(MODEL_PATH, io);
}

describe('glTF サブセットローダ', () => {
  it('メッシュ・属性・インデックスを読む', async () => {
    const model = await load();
    const prim = model.meshes[0]?.primitives[0];
    expect(prim).toBeDefined();
    expect(prim?.positions).toHaveLength(18); // 6 頂点 × 3
    expect(prim?.normals).toHaveLength(18);
    expect(prim?.uvs).toHaveLength(12);
    expect(prim?.indices).toHaveLength(12); // 三角形 4 枚
    expect(Array.from(prim?.positions.slice(0, 3) ?? [])).toEqual([-0.5, 0, 0]);
  });

  it('スキン（JOINTS_0 / WEIGHTS_0 / 逆バインド行列）を読む', async () => {
    const model = await load();
    const prim = model.meshes[0]?.primitives[0];
    expect(prim?.joints).toHaveLength(24); // 6 頂点 × 4
    expect(prim?.weights).toHaveLength(24);
    expect(model.skins[0]?.joints).toEqual([1, 2]);
    expect(model.skins[0]?.inverseBindMatrices).toHaveLength(32);
    // 中段の頂点は 2 ボーンに半々で割り当てられている
    expect(Array.from(prim?.weights?.slice(8, 12) ?? [])).toEqual([0.5, 0.5, 0, 0]);
  });

  it('ノード階層と TRS を読む', async () => {
    const model = await load();
    expect(model.nodes.map((n) => n.name)).toEqual(['strip', 'bone0', 'bone1']);
    expect(model.nodes[1]?.children).toEqual([2]);
    expect(model.nodes[2]?.translation).toEqual([0, 1, 0]);
    expect(model.roots).toEqual([0, 1]);
  });

  it('マテリアルの baseColorFactor を読む', async () => {
    const model = await load();
    expect(model.materials[0]?.baseColorFactor).toEqual([0.9, 0.4, 0.2, 1]);
    expect(model.materials[0]?.baseColorImage).toBeNull();
  });

  it('アニメーションのチャンネルと長さを読む', async () => {
    const model = await load();
    const anim = model.animations[0];
    expect(anim?.name).toBe('bend');
    expect(anim?.durationSeconds).toBe(1);
    expect(anim?.channels[0]?.path).toBe('rotation');
    expect(anim?.channels[0]?.node).toBe(2);
  });
});

describe('ポーズとスキニング', () => {
  it('t=0 ではバインドポーズ（ジョイント行列が単位行列）', async () => {
    const model = await load();
    const pose = createPose(model);
    const globals = new Float32Array(model.nodes.length * 16);
    const jointMatrices = new Float32Array(model.skins[0]!.joints.length * 16);

    sampleAnimation(model.animations[0]!, 0, pose);
    computeGlobalMatrices(model, pose, globals);
    computeJointMatrices(model, 0, globals, jointMatrices);

    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(Array.from(jointMatrices.slice(0, 16)).map((v) => Math.round(v * 1e6) / 1e6)).toEqual(identity);
    expect(Array.from(jointMatrices.slice(16, 32)).map((v) => Math.round(v * 1e6) / 1e6)).toEqual(identity);
  });

  it('t=0.5 で bone1 が Z 軸まわりに 90 度回る（ボーンアニメが効いている）', async () => {
    const model = await load();
    const pose = createPose(model);
    const globals = new Float32Array(model.nodes.length * 16);
    const jointMatrices = new Float32Array(32);

    sampleAnimation(model.animations[0]!, 0.5, pose);
    computeGlobalMatrices(model, pose, globals);
    computeJointMatrices(model, 0, globals, jointMatrices);

    // bone1 のジョイント行列は「原点(0,1,0)まわりの 90 度回転」になる
    const m = Array.from(jointMatrices.slice(16, 32)).map((v) => Math.round(v * 1e6) / 1e6);
    expect(m[0]).toBeCloseTo(0, 5); // cos90
    expect(m[1]).toBeCloseTo(1, 5); // sin90
    expect(m[4]).toBeCloseTo(-1, 5);
    expect(m[5]).toBeCloseTo(0, 5);
    // 平行移動成分: (0,1,0) が動かないように補正されている
    expect(m[12]).toBeCloseTo(1, 5);
    expect(m[13]).toBeCloseTo(1, 5);
  });

  it('LINEAR 補間はキーフレーム間で連続的に変化する', async () => {
    const model = await load();
    const pose = createPose(model);
    const angles: number[] = [];
    for (const t of [0, 0.125, 0.25, 0.375, 0.5]) {
      sampleAnimation(model.animations[0]!, t, pose);
      angles.push(pose.rotation[2 * 4 + 2] ?? 0); // bone1 の quaternion.z
    }
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i]!).toBeGreaterThan(angles[i - 1]!);
    }
  });

  it('ループ再生では t=1.5 が t=0.5 と一致する（決定的）', async () => {
    const model = await load();
    const a = createPose(model);
    const b = createPose(model);
    sampleAnimation(model.animations[0]!, 0.5, a);
    sampleAnimation(model.animations[0]!, 1.5, b);
    expect(Array.from(a.rotation)).toEqual(Array.from(b.rotation));
  });

  it('同じ時刻を何度サンプリングしても同じ結果（不変条件 I4）', async () => {
    const model = await load();
    const pose = createPose(model);
    sampleAnimation(model.animations[0]!, 0.3, pose);
    const first = Array.from(pose.rotation);
    sampleAnimation(model.animations[0]!, 0.3, pose);
    expect(Array.from(pose.rotation)).toEqual(first);
  });
});

describe('サブセット外は明示的に失敗する', () => {
  const base = { asset: { version: '2.0' } };

  it('glTF 1.0 を拒否する', () => {
    expect(() => parseGltf({ asset: { version: '1.0' } }, [])).toThrow(GltfSubsetError);
  });

  it('必須拡張を拒否する', () => {
    expect(() => parseGltf({ ...base, extensionsRequired: ['KHR_draco_mesh_compression'] }, [])).toThrow(
      /必須拡張/,
    );
  });

  it('node の matrix を拒否する（TRS で出力させる）', () => {
    expect(() =>
      parseGltf({ ...base, nodes: [{ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] }, []),
    ).toThrow(/TRS で出力/);
  });

  it('TRIANGLES 以外の mode を拒否する', () => {
    expect(() =>
      parseGltf({ ...base, meshes: [{ primitives: [{ mode: 1, attributes: { POSITION: 0 } }] }] }, []),
    ).toThrow(/TRIANGLES/);
  });

  it('モーフターゲットを拒否する', () => {
    expect(() =>
      parseGltf({ ...base, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, targets: [{}] }] }] }, []),
    ).toThrow(/モーフターゲット/);
  });

  it('CUBICSPLINE 補間を拒否する', () => {
    expect(() =>
      parseGltf(
        {
          ...base,
          animations: [
            {
              samplers: [{ input: 0, output: 1, interpolation: 'CUBICSPLINE' }],
              channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
            },
          ],
        },
        [],
      ),
    ).toThrow(/未対応の補間/);
  });
});
