/**
 * P1-2 の殻：見た目と当たり判定が同じ 1 つの定義から出ていること（T1-27 の「一貫性」）。
 *
 * `tools/blender_export_shell.py` が形の正本で、
 * 見た目（`props_shell.gltf`）と当たり判定（`props_shell.plates.json`）の両方を書き出す。
 * **レベル側の当たり判定がその表からずれたら、ここで落ちる。**
 * 「裂けて見える継ぎ目」と「通れる穴」が別々に動いていくのを防ぐのが目的。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLevel } from '@/level/loader';
import { materialFor } from '@/render/material';
import type { LevelFile } from '@/level/schema';

interface Plate {
  name: string;
  center: [number, number, number];
  half: [number, number, number];
}

const shape = JSON.parse(readFileSync('public/assets/models/props_shell.plates.json', 'utf8')) as {
  seam: string;
  plates: Plate[];
};

const LEVELS: Array<[string, LevelFile]> = ['area1', 'puzzle_lab'].map((id) => [
  id,
  parseLevel(JSON.parse(readFileSync(`public/assets/levels/${id}.json`, 'utf8')), id),
]);

describe('殻の形（見た目と当たり判定の一致）', () => {
  for (const [id, level] of LEVELS) {
    const shell = level.entities.find((entity) => entity.id === 'p1_2_shell')!;

    it(`${id}: 殻の板がスクリプトの定義どおりに置かれている`, () => {
      expect(shell, 'p1_2_shell が無い').toBeDefined();
      const center = shell.transform.position;
      const half = shell.collider!.halfExtents;

      for (const plate of shape.plates) {
        const entityId = plate.name === shape.seam ? 'p1_2_seam' : `p1_2_${plate.name}`;
        const entity = level.entities.find((e) => e.id === entityId);
        expect(entity, `${entityId} が無い`).toBeDefined();
        for (let axis = 0; axis < 3; axis++) {
          expect(entity!.transform.position[axis]).toBeCloseTo(center[axis]! + plate.center[axis]! * half[axis]!, 5);
          expect(entity!.collider!.halfExtents[axis]).toBeCloseTo(plate.half[axis]! * half[axis]!, 5);
        }
      }
    });

    it(`${id}: 殻の見た目は 1 つのモデルが受け持ち、板は当たり判定だけを持つ`, () => {
      expect(materialFor(shell.type).model).toBe('props_shell');
      expect(materialFor(shell.type).polygonSort).toBe(true);
      // 殻そのものは通せんぼしない（壁になるのは板のほう）
      expect(shell.collider!.solid).toBe(false);
      for (const plate of shape.plates) {
        const entityId = plate.name === shape.seam ? 'p1_2_seam' : `p1_2_${plate.name}`;
        const entity = level.entities.find((e) => e.id === entityId)!;
        expect(materialFor(entity.type).collisionOnly, entityId).toBe(true);
      }
    });

    it(`${id}: 核は殻の内側に完全に収まっている`, () => {
      const core = level.entities.find((entity) => entity.id === 'p1_2_core')!;
      const center = shell.transform.position;
      const half = shell.collider!.halfExtents;
      // 内側 = 板の内面で囲まれた空間。厚み 0.125（単位箱）の板を除いた範囲
      for (const axis of [0, 2]) {
        const inner = half[axis]! * (1 - 0.125 * 2);
        expect(Math.abs(core.transform.position[axis]! - center[axis]!) + core.collider!.halfExtents[axis]!)
          .toBeLessThanOrEqual(inner + 1e-6);
      }
    });
  }

  it('通れる穴は継ぎ目 1 箇所だけ', () => {
    const seams = shape.plates.filter((plate) => plate.name === shape.seam);
    expect(seams).toHaveLength(1);
    for (const [, level] of LEVELS) {
      const gated = level.entities.filter((entity) => entity.type === 'shell_seam');
      expect(gated.map((entity) => entity.id)).toEqual(['p1_2_seam']);
    }
  });
});
