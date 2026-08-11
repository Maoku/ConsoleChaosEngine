import { describe, it, expect } from 'vitest';
import {
  createSortWorkspace,
  sortTrianglesByDepthNaive,
  sortTrianglesByDepthRadix,
} from '@/render/sort';

/** 決定的な乱数（テストの再現性のため。core/rng.ts と同じ考え方） */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 三角形ごとにばらばらの深度を持つメッシュを作る */
function makeMesh(triangles: number, seed = 12345) {
  const random = mulberry32(seed);
  const positions = new Float32Array(triangles * 9);
  const indices = new Uint32Array(triangles * 3);
  for (let t = 0; t < triangles; t++) {
    const z = -random() * 100;
    for (let v = 0; v < 3; v++) {
      const i = (t * 3 + v) * 3;
      positions[i] = random() * 2 - 1;
      positions[i + 1] = random() * 2 - 1;
      positions[i + 2] = z;
      indices[t * 3 + v] = t * 3 + v;
    }
  }
  return { positions, indices };
}

function centroidDistances(positions: Float32Array, indices: Uint32Array, camera: number[]): number[] {
  const out: number[] = [];
  for (let t = 0; t < indices.length / 3; t++) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let v = 0; v < 3; v++) {
      const i = (indices[t * 3 + v] ?? 0) * 3;
      cx += positions[i] ?? 0;
      cy += positions[i + 1] ?? 0;
      cz += positions[i + 2] ?? 0;
    }
    cx = cx / 3 - (camera[0] ?? 0);
    cy = cy / 3 - (camera[1] ?? 0);
    cz = cz / 3 - (camera[2] ?? 0);
    out.push(cx * cx + cy * cy + cz * cz);
  }
  return out;
}

const CAMERA = [0, 0, 5];

describe('三角形ソート', () => {
  it('遠い三角形から順に並ぶ（奥から描く）', () => {
    const { positions, indices } = makeMesh(64);
    const out = new Uint32Array(indices.length);
    const ws = createSortWorkspace(64);
    sortTrianglesByDepthRadix(positions, indices, CAMERA, out, ws);

    const distances = centroidDistances(positions, out, CAMERA);
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]!).toBeLessThanOrEqual(distances[i - 1]! + 1e-3);
    }
  });

  it('素朴版と最適化版の結果が一致する（ゴールデン比較）', () => {
    const { positions, indices } = makeMesh(500, 777);
    const ws = createSortWorkspace(500);
    const naive = new Uint32Array(indices.length);
    const radix = new Uint32Array(indices.length);
    sortTrianglesByDepthNaive(positions, indices, CAMERA, naive, ws);
    sortTrianglesByDepthRadix(positions, indices, CAMERA, radix, ws);

    // 最適化版は距離を 16bit へ量子化するため、同一バケットに落ちた三角形の
    // 順序は素朴版と入れ替わりうる。許容差は「バケット 1 個分」とする。
    const a = centroidDistances(positions, naive, CAMERA);
    const b = centroidDistances(positions, radix, CAMERA);
    const bucket = (Math.max(...a) - Math.min(...a)) / 65535;
    for (let i = 0; i < a.length; i++) {
      expect(Math.abs(b[i]! - a[i]!)).toBeLessThanOrEqual(bucket * 2);
    }
  });

  it('三角形の頂点の組は壊れない（インデックスの入れ替えのみ）', () => {
    const { positions, indices } = makeMesh(32);
    const out = new Uint32Array(indices.length);
    const ws = createSortWorkspace(32);
    sortTrianglesByDepthRadix(positions, indices, CAMERA, out, ws);

    const original = new Set<string>();
    for (let t = 0; t < 32; t++) {
      original.add([indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]].join(','));
    }
    for (let t = 0; t < 32; t++) {
      expect(original.has([out[t * 3], out[t * 3 + 1], out[t * 3 + 2]].join(','))).toBe(true);
    }
  });

  it('同じ入力なら常に同じ結果（決定的：不変条件 I4）', () => {
    const { positions, indices } = makeMesh(128, 99);
    const ws = createSortWorkspace(128);
    const first = new Uint32Array(indices.length);
    const second = new Uint32Array(indices.length);
    sortTrianglesByDepthRadix(positions, indices, CAMERA, first, ws);
    sortTrianglesByDepthRadix(positions, indices, CAMERA, second, ws);
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it('Uint16Array のインデックスでも動く', () => {
    const triangles = 20;
    const positions = new Float32Array(triangles * 9);
    const indices = new Uint16Array(triangles * 3);
    for (let t = 0; t < triangles; t++) {
      for (let v = 0; v < 3; v++) {
        const i = (t * 3 + v) * 3;
        positions[i + 2] = -t;
        indices[t * 3 + v] = t * 3 + v;
      }
    }
    const out = new Uint16Array(indices.length);
    const ws = createSortWorkspace(triangles);
    sortTrianglesByDepthRadix(positions, indices, CAMERA, out, ws);
    // 最も遠い（z = -19）三角形が先頭
    expect(out[0]).toBe(19 * 3);
  });

  it('全三角形が同じ距離でも壊れない（span = 0）', () => {
    const triangles = 8;
    const positions = new Float32Array(triangles * 9);
    const indices = new Uint32Array(triangles * 3);
    for (let t = 0; t < triangles; t++) {
      for (let v = 0; v < 3; v++) indices[t * 3 + v] = t * 3 + v;
    }
    const out = new Uint32Array(indices.length);
    const ws = createSortWorkspace(triangles);
    expect(() => sortTrianglesByDepthRadix(positions, indices, CAMERA, out, ws)).not.toThrow();
    expect(new Set(Array.from(out)).size).toBe(triangles * 3);
  });

  it('作業用配列を使い回し、呼び出しごとに確保しない', () => {
    const { positions, indices } = makeMesh(256);
    const ws = createSortWorkspace(256);
    const out = new Uint32Array(indices.length);
    const keysBefore = ws.keys;
    for (let i = 0; i < 10; i++) sortTrianglesByDepthRadix(positions, indices, CAMERA, out, ws);
    expect(ws.keys).toBe(keysBefore);
  });
});
