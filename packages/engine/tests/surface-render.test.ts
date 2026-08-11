import { describe, expect, it } from 'vitest';
import { HARDWARE_GENERATION_PROFILES } from '../src/generation/profiles';
import { affineUvAt, validateAffineSurface } from '../src/render/affine/reference';
import { createRenderFrame, renderFrameSnapshot, type AffineSurfaceCommand, type RasterSurfaceCommand } from '../src/render/frame';
import { createRasterLookupEncoder, validateRasterSurface } from '../src/render/raster/validate';

const raster = (scanlines: Float32Array): RasterSurfaceCommand => ({
  id: 'raster',
  generations: ['FC'],
  texture: 'road.png',
  screenRect: [0, 100, 256, scanlines.length / 4],
  scanlines,
});

const affine: AffineSurfaceCommand = {
  id: 'affine',
  generations: ['SFC'],
  texture: 'tile.png',
  screenRect: [0, 96, 256, 128],
  uvOrigin: [0.1, 0.2],
  uvStepX: [0.01, 0],
  uvStepY: [0, 0.02],
};

describe('surface render contracts', () => {
  it('advertises raster, affine, and environment capabilities without ID checks in render code', () => {
    expect(HARDWARE_GENERATION_PROFILES.FC.video.rasterScroll).toBe(true);
    expect(HARDWARE_GENERATION_PROFILES.SFC.video.affinePlane).toBe(true);
    expect(HARDWARE_GENERATION_PROFILES.PS1.video.environmentMap).toBe(false);
    expect(HARDWARE_GENERATION_PROFILES.PS2.video.environmentMap).toBe(true);
  });

  it('validates raster tables and reuses the encoded upload buffer', () => {
    const table = new Float32Array([
      0.5, 0.5, 0.25, 1,
      1.25, 0.25, -0.25, 0.5,
    ]);
    expect(validateRasterSurface(raster(table), [256, 224])).toBe(2);
    const encoder = createRasterLookupEncoder();
    const first = encoder.encode(table);
    const second = encoder.encode(table);
    expect(second).toBe(first);
    expect([...second.slice(0, 8)]).toEqual([128, 128, 64, 255, 64, 64, 191, 128]);
    expect(() => validateRasterSurface(raster(new Float32Array([0.5, 0, 0.5, 1])))).toThrow(/width/);
    expect(() => validateRasterSurface({ ...raster(table), screenRect: [0, 223, 256, 2] }, [256, 224])).toThrow(/outside/);
  });

  it('shares the exact affine formula between the CPU reference and shader contract', () => {
    expect(() => validateAffineSurface(affine, [256, 224])).not.toThrow();
    expect(affineUvAt(affine, [10, 5], 'repeat')).toEqual([0.2, 0.30000000000000004]);
    expect(() => validateAffineSurface({ ...affine, uvStepX: [Number.NaN, 0] })).toThrow(/finite/);
  });

  it('resets surfaces and keeps legacy empty-frame serialization stable', () => {
    const frame = createRenderFrame();
    const empty = renderFrameSnapshot(frame);
    expect(empty).not.toHaveProperty('rasterSurfaces');
    expect(empty).not.toHaveProperty('affineSurfaces');
    frame.rasterSurfaces.push(raster(new Float32Array([0.5, 0.5, 0.5, 1])));
    frame.affineSurfaces.push(affine);
    expect(renderFrameSnapshot(frame)).toMatchObject({ rasterSurfaces: [{ id: 'raster' }], affineSurfaces: [{ id: 'affine' }] });
    frame.reset();
    expect(frame.rasterSurfaces).toHaveLength(0);
    expect(frame.affineSurfaces).toHaveLength(0);
  });
});
