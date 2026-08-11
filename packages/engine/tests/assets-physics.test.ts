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

  it('loads text/binary once and restores managed GPU resources', async () => {
    const fetcher = vi.fn(async (url: string) => new Response(url === '/text' ? 'hello' : new Uint8Array([1, 2, 3])));
    const manager = createAssetManager(fetcher as typeof fetch);
    const text = await manager.loadText('/text');
    const binary = await manager.loadBinary('/binary');
    expect(text.value).toBe('hello');
    expect([...new Uint8Array(binary.value)]).toEqual([1, 2, 3]);

    let generation = 0;
    const released: number[] = [];
    const gpu = await manager.acquireGpu('pipeline', () => ++generation, (value) => released.push(value));
    expect(gpu.value).toBe(1);
    await manager.restoreGpuResources();
    expect(gpu.value).toBe(2);
    expect(released).toEqual([1]);
    gpu.release();
    text.release();
    binary.release();
    manager.dispose();
  });

  it('rebuilds context resources repeatedly without growing the registry', async () => {
    const created: number[] = [];
    const released: number[] = [];
    const manager = createAssetManager();
    const resource = await manager.acquireGpu(
      'context-resource',
      () => {
        const value = created.length + 1;
        created.push(value);
        return value;
      },
      (value) => released.push(value),
    );
    for (let restore = 0; restore < 10; restore++) {
      await manager.restoreGpuResources();
      expect(manager.activeCount).toBe(1);
      expect(manager.gpuCount).toBe(1);
    }
    expect(resource.value).toBe(11);
    expect(released).toEqual(created.slice(0, -1));
    resource.release();
    expect(released).toEqual(created);
    expect(manager.activeCount).toBe(0);
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
