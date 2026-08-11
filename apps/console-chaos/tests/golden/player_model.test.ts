/**
 * プレイヤーモデルのゴールデン（T2-07）。
 *
 * `GenerationProfile.player` は **アセット内の名前**を直に指す唯一の場所なので、
 * ここが実物とずれると「立っているのに足踏みする」「ジャンプで待機が出る」といった
 * 実行時にしか分からない壊れ方をする。名前の対応は CI で機械的に見る。
 *
 * 併せて、シェーダの `uJoints[24]` に収まることも見る（描画が黙って崩れる側の制約）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadGltf, type GltfIO, type GltfModel } from '@/render/loader/gltf';
import { GENERATION_IDS, PROFILES, type PlayerClip } from '@/generation/profiles';

const MODEL_DIR = 'public/assets/models';

/** シェーダの `const int MAX_JOINTS` と一致させる（Docs/asset-rules.md §5） */
const MAX_JOINTS = 24;

const CLIPS: PlayerClip[] = ['idle', 'walk', 'jump'];

const io: GltfIO = {
  async fetchJson(url) {
    return JSON.parse(readFileSync(url, 'utf8'));
  },
  async fetchBinary(url) {
    const buf = readFileSync(url);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  },
};

/** モデルで描く世代だけがここの対象。2D の 2 世代は絵で描く（T2-09 / T2-11。player_sprite.test.ts） */
const MODEL_IDS = GENERATION_IDS.filter((id) => PROFILES[id].player.kind === 'model');

const models = new Map<string, GltfModel>();
for (const file of new Set(MODEL_IDS.map((id) => PROFILES[id].player.file))) {
  models.set(file, await loadGltf(join(MODEL_DIR, file), io));
}

describe('プレイヤーモデル', () => {
  it('モデルで描く世代がモデルを指し、その実体がある', () => {
    expect(MODEL_IDS).toEqual(['PS1', 'PS2']);
    for (const id of MODEL_IDS) {
      const file = PROFILES[id].player.file;
      expect(existsSync(join(MODEL_DIR, file)), `${id} の ${file} が無い`).toBe(true);
    }
  });

  for (const id of MODEL_IDS) {
    const player = PROFILES[id].player;
    if (player.kind !== 'model') continue;

    it(`${id}: idle / walk / jump の 3 つがアセットの実在するアニメーションを指す`, () => {
      const model = models.get(player.file)!;
      const names = model.animations.map((animation) => animation.name);
      for (const clip of CLIPS) {
        expect(names, `${player.file} に ${player.clips[clip].animation} が無い`).toContain(
          player.clips[clip].animation,
        );
      }
    });

    it(`${id}: スキンを持ち、ジョイント数が ${MAX_JOINTS} 以下`, () => {
      const model = models.get(player.file)!;
      expect(model.skins.length, `${player.file} にスキンが無い`).toBeGreaterThan(0);
      for (const skin of model.skins) expect(skin.joints.length).toBeLessThanOrEqual(MAX_JOINTS);
    });

    it(`${id}: 頂点ごとのジョイント参照がスキンの範囲に収まる`, () => {
      const model = models.get(player.file)!;
      const count = model.skins[0]!.joints.length;
      for (const mesh of model.meshes) {
        for (const primitive of mesh.primitives) {
          if (!primitive.joints) continue;
          for (const joint of primitive.joints) expect(joint).toBeLessThan(count);
        }
      }
    });
  }

  it('第3・第4世代は絵を持つ（黒一色に潰れない）', () => {
    // baseColorTexture を持たないと baseColorFactor だけで塗られる。
    // gen4 は出力時 baseColorFactor が黒だったので、ここが最後の砦になる
    for (const file of ['gen3_character.glb', 'gen4_character.glb']) {
      const model = models.get(file)!;
      const used = model.meshes.flatMap((mesh) =>
        mesh.primitives.map((primitive) =>
          primitive.material === null ? null : model.materials[primitive.material]!,
        ),
      );
      expect(used.length).toBeGreaterThan(0);
      for (const material of used) {
        expect(material?.baseColorImage, `${file} の ${material?.name} に絵が無い`).not.toBeNull();
        const image = model.images[material!.baseColorImage!]!;
        expect(image.data, `${file} の絵が埋め込まれていない`).not.toBeNull();
      }
    }
  });

  it('モデルの原点は足元にあり、身長が当たり判定（1.6m）と大きくずれない', () => {
    for (const [file, model] of models) {
      let low = Infinity;
      let high = -Infinity;
      for (const mesh of model.meshes) {
        for (const primitive of mesh.primitives) {
          for (let i = 1; i < primitive.positions.length; i += 3) {
            const y = primitive.positions[i]!;
            if (y < low) low = y;
            if (y > high) high = y;
          }
        }
      }
      expect(Math.abs(low), `${file} の原点が足元にない`).toBeLessThan(0.05);
      expect(high, `${file} が低すぎる`).toBeGreaterThan(1.2);
      expect(high, `${file} が高すぎる`).toBeLessThan(2.1);
    }
  });
});
