import { describe, expect, it, vi } from 'vitest';
import { createAssetManager } from '../src/assets/manager';
import { aabbFromCenter, nearestPointOnSegment, overlaps, sweepAabb } from '../src/physics/aabb';
import { validateSceneReferences, type SceneData } from '../src/scene/schema';

describe('asset manager', () => {
  it('deduplicates pending loads and releases by reference count', async () => {
    const load = vi.fn(async () => ({ value: 42 }));
    const dispose = vi.fn();
    const assets = createAssetManager();
    const [first, second] = await Promise.all([
      assets.acquire('answer', load, dispose),
      assets.acquire('answer', load, dispose),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    first.release();
    expect(assets.activeCount).toBe(1);
    second.release();
    expect(assets.activeCount).toBe(0);
    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe('physics helpers', () => {
  it('tests overlap and swept collision in all three axes', () => {
    const moving = aabbFromCenter([0, 0, 0], [0.5, 0.5, 0.5]);
    const target = aabbFromCenter([2, 0, 0], [0.5, 0.5, 0.5]);
    expect(overlaps(moving, target)).toBe(false);
    expect(sweepAabb(moving, [2, 0, 0], target)).toEqual({ time: 0.5, normal: [-1, 0, 0] });
    expect(nearestPointOnSegment([3, 0, 2], [0, 0, 0], [4, 0, 0])).toEqual([3, 0, 0]);
  });
});

describe('scene schema', () => {
  it('validates generic entity and visibility references', () => {
    const scene: SceneData = {
      id: 'example',
      sectors: [{ id: 'entry', center: [0, 0, 0], halfExtents: [4, 4, 4], visible: ['missing'] }],
      entities: [
        { id: 'item', transform: { position: [0, 0, 0] }, sector: 'entry', tags: ['interactive'] },
        { id: 'item', transform: { position: [1, 0, 0] }, sector: 'missing', tags: [] },
      ],
    };
    expect(validateSceneReferences(scene).map((issue) => issue.path)).toEqual([
      'sectors[0].visible[0]',
      'entities[1].id',
      'entities[1].sector',
    ]);
  });
});
