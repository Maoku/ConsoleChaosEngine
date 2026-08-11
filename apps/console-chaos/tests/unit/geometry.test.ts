/**
 * 分割つきの箱（T1-22）。
 *
 * ここで固定するのは 2 つ。
 *   1. 分割しても**表向き（CCW）と法線が保たれる**こと。崩れると裏面カリングで面が消える
 *   2. area1 全体が**三角形予算 20,000 に収まる**こと（asset-rules.md §8、T0-09 の決定）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { billboardMesh, boxMesh, segmentsFor, triangleCountOf, unitCube, DEFAULT_MAX_SEGMENTS } from '@console-chaos/engine';
import { collidersOf, parseLevel } from '@/level/loader';
import { materialFor } from '@/render/material';

/** T0-09 で決めたフレームあたりの上限（第3世代） */
const TRIANGLE_BUDGET = 20000;
/** 第4世代の上限（asset-rules.md §8） */
const PS2_TRIANGLE_BUDGET = 80000;
/** player.gltf の三角形数（T1-08） */
const PLAYER_TRIANGLES = 108;
/**
 * プロップモデルの三角形数（`npm run check:assets` の `gltf-preflight` が印字する値）。
 * モデルを持つ要素は箱を描かないので、見積りもモデル側の数で取る
 */
const PROP_TRIANGLES: Record<string, number> = {
  props_vine: 8,
  props_enemy: 8,
  props_mark: 12,
  props_caster: 16,
  props_switch: 28,
  props_pedestal: 48,
  props_shell: 96,
  props_gate: 92,
};

function faceOrientations(mesh: ReturnType<typeof boxMesh>): { outward: number; inward: number } {
  let outward = 0;
  let inward = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const p = [0, 1, 2].map((k) => {
      const base = mesh.indices[t + k]! * 8;
      return [mesh.vertices[base]!, mesh.vertices[base + 1]!, mesh.vertices[base + 2]!];
    });
    const normalBase = mesh.indices[t]! * 8;
    const normal = [mesh.vertices[normalBase + 3]!, mesh.vertices[normalBase + 4]!, mesh.vertices[normalBase + 5]!];
    const a = [p[1]![0]! - p[0]![0]!, p[1]![1]! - p[0]![1]!, p[1]![2]! - p[0]![2]!];
    const b = [p[2]![0]! - p[0]![0]!, p[2]![1]! - p[0]![1]!, p[2]![2]! - p[0]![2]!];
    const cross = [
      a[1]! * b[2]! - a[2]! * b[1]!,
      a[2]! * b[0]! - a[0]! * b[2]!,
      a[0]! * b[1]! - a[1]! * b[0]!,
    ];
    const dot = cross[0]! * normal[0]! + cross[1]! * normal[1]! + cross[2]! * normal[2]!;
    if (dot > 0) outward++;
    else inward++;
  }
  return { outward, inward };
}

describe('分割つきの箱', () => {
  it('分割なしの単位立方体は 12 三角形', () => {
    const mesh = unitCube();
    expect(mesh.triangles).toBe(12);
    expect(mesh.vertices.length / 8).toBe(24);
  });

  it('どの分割数でもすべての三角形が表向き（CCW）', () => {
    for (const half of [[1, 1, 1], [4, 0.25, 2], [0.5, 1.5, 0.25], [8, 0.25, 5]] as const) {
      const mesh = boxMesh(half, { uvScale: 0.5 });
      const { outward, inward } = faceOrientations(mesh);
      expect(inward, `half=${half.join(',')} に裏向きの三角形がある`).toBe(0);
      expect(outward).toBe(mesh.triangles);
    }
  });

  it('頂点は箱の外へ出ない', () => {
    const half = [3, 0.25, 2] as const;
    const mesh = boxMesh(half, { uvScale: 0.5 });
    for (let i = 0; i < mesh.vertices.length; i += 8) {
      for (let axis = 0; axis < 3; axis++) {
        expect(Math.abs(mesh.vertices[i + axis]!)).toBeLessThanOrEqual(half[axis]! + 1e-6);
      }
    }
  });

  it('分割数は大きさに比例し、上限で頭打ちになる', () => {
    expect(segmentsFor([0.25, 0.25, 0.25])).toEqual([1, 1, 1]);
    expect(segmentsFor([1.5, 0.25, 1])).toEqual([3, 1, 2]);
    expect(segmentsFor([100, 100, 100])).toEqual([
      DEFAULT_MAX_SEGMENTS,
      DEFAULT_MAX_SEGMENTS,
      DEFAULT_MAX_SEGMENTS,
    ]);
  });

  it('大きな床は実際に分割される（8 頂点のままにならない）', () => {
    const mesh = boxMesh([8, 0.25, 4], { uvScale: 0.5 });
    // 分割前は 12 三角形。これを大きく超えていること
    expect(mesh.triangles).toBeGreaterThan(100);
    expect(mesh.triangles).toBe(triangleCountOf(segmentsFor([8, 0.25, 4])));
  });

  it('敷き詰める面の UV はワールド寸法から作られる（大きさが違っても模様が揃う）', () => {
    const small = boxMesh([1, 0.25, 1], { uvScale: 0.5 });
    const large = boxMesh([4, 0.25, 1], { uvScale: 0.5 });
    const uRange = (mesh: ReturnType<typeof boxMesh>): number => {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 6; i < mesh.vertices.length; i += 8) {
        min = Math.min(min, mesh.vertices[i]!);
        max = Math.max(max, mesh.vertices[i]!);
      }
      return max - min;
    };
    // 幅 4 倍の床には、繰り返しも 4 倍入る
    expect(uRange(large)).toBeCloseTo(uRange(small) * 4, 5);
  });

  it('プロップは面いっぱいに 1 枚貼る（UV は 0..1）', () => {
    const mesh = boxMesh([0.75, 0.75, 0.75], { uvScale: 0 });
    for (let i = 6; i < mesh.vertices.length; i += 8) {
      expect(mesh.vertices[i]!).toBeGreaterThanOrEqual(0);
      expect(mesh.vertices[i]!).toBeLessThanOrEqual(1);
    }
  });
});

describe('スプライトの板（T2-09）', () => {
  const rect = { u0: 0.25, v0: 0.5, u1: 0.5, v1: 0.75 };
  const mesh = billboardMesh(rect);

  it('カメラの方（+Z）を向いた 1 枚の板', () => {
    expect(mesh.triangles).toBe(2);
    for (let i = 0; i < mesh.vertices.length; i += 8) {
      expect(mesh.vertices[i + 2]).toBe(0);
      expect([mesh.vertices[i + 3], mesh.vertices[i + 4], mesh.vertices[i + 5]]).toEqual([0, 0, 1]);
    }
  });

  it('絵が上下逆にならない（板の上辺に v0 が来る）', () => {
    // v の原点は画像の上端。y = +1 の頂点に v0、y = -1 の頂点に v1 が乗る
    for (let i = 0; i < mesh.vertices.length; i += 8) {
      const y = mesh.vertices[i + 1]!;
      expect(mesh.vertices[i + 7], `y=${y}`).toBeCloseTo(y > 0 ? rect.v0 : rect.v1, 12);
      expect(mesh.vertices[i + 6]).toBeCloseTo(mesh.vertices[i]! > 0 ? rect.u1 : rect.u0, 12);
    }
  });
});

describe('三角形予算（asset-rules.md §8）', () => {
  const area1 = parseLevel(JSON.parse(readFileSync('public/assets/levels/area1.json', 'utf8')), 'area1.json');

  /**
   * 1 要素ぶんの見積り（SG-11 で装飾へ広げた）。
   *
   * プロップモデルを持つものはその三角形数、持たないものは分割つきの箱。
   * 装飾は `collider` を持たないので、大きさは `transform.scale` から来る（SG-05）。
   */
  function trianglesOf(entity: (typeof area1.entities)[number]): number {
    const material = materialFor(entity.type, entity.id);
    if (material.collisionOnly) return 0;
    if (material.model) return PROP_TRIANGLES[material.model] ?? 0;
    const half = entity.collider?.halfExtents ?? entity.transform.scale ?? [1, 1, 1];
    return triangleCountOf(segmentsFor(half as [number, number, number]));
  }

  it('area1 の全要素 + プレイヤーが第3世代の 20,000 三角形に収まる', () => {
    // **装飾（草木・雲・立方体・滝）を足したあとも収まること**が SG-11 の受け入れ条件。
    // 第3世代がいちばん厳しいので、ここを通れば第4世代の 80,000 は自動的に通る
    const total = PLAYER_TRIANGLES + area1.entities.reduce((sum, e) => sum + trianglesOf(e), 0);
    expect(total, `見積り ${total} 三角形`).toBeLessThanOrEqual(TRIANGLE_BUDGET);
    expect(total, '見積りが 0 に近い（数え漏らしている）').toBeGreaterThan(4000);
  });

  it('装飾のぶんが予算の半分を超えない（飾りが主役を圧迫しない）', () => {
    const decor = area1.entities.filter((entity) => materialFor(entity.type, entity.id).decoration);
    const solid = area1.entities.filter((entity) => !materialFor(entity.type, entity.id).decoration);
    const decorTriangles = decor.reduce((sum, e) => sum + trianglesOf(e), 0);
    const solidTriangles = solid.reduce((sum, e) => sum + trianglesOf(e), 0);
    expect(decor.length, '装飾が 1 つも無い').toBeGreaterThan(50);
    expect(decorTriangles).toBeLessThan(solidTriangles);
  });

  it('当たり判定を持つ要素だけでも第4世代の 80,000 に収まる（世界そのものの重さ）', () => {
    const total =
      PLAYER_TRIANGLES + collidersOf(area1).reduce((sum, entity) => sum + trianglesOf(entity), 0);
    expect(total).toBeLessThanOrEqual(PS2_TRIANGLE_BUDGET);
  });
});
