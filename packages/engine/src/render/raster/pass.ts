import type { RasterSurfaceCommand, Vec2 } from '../frame';
import { BLEND_NONE, createProgram, createTexture, type GLContext, type Program, type StateCache, type Texture } from '../gl/index';
import { createRasterLookupEncoder, validateRasterSurface } from './validate';
import { RASTER_SURFACE_FRAGMENT, RASTER_SURFACE_VERTEX } from './shader';

export interface RasterSurfacePass {
  draw(command: RasterSurfaceCommand, source: Texture, resolution: Vec2): void;
  readonly lookupCapacity: number;
  dispose(): void;
}

export function createRasterSurfacePass(ctx: GLContext, state: StateCache): RasterSurfacePass {
  const { gl } = ctx;
  const program: Program = createProgram(ctx, 'raster-surface', RASTER_SURFACE_VERTEX, RASTER_SURFACE_FRAGMENT);
  const lookup = createTexture(ctx, { width: 1, height: 1, filter: 'nearest', wrap: 'clamp' });
  const encoder = createRasterLookupEncoder();
  return {
    get lookupCapacity() {
      return encoder.bytes.length / 4;
    },
    draw(command, source, resolution): void {
      const rows = validateRasterSurface(command, resolution);
      lookup.upload(encoder.encode(command.scanlines), 1, rows);
      state.apply({ depthTest: false, depthWrite: false, blend: BLEND_NONE, cull: 'none' });
      program.use();
      gl.bindVertexArray(null);
      program.setUniforms({
        uSource: source,
        uScanlines: lookup,
        uResolution: resolution,
        uScreenRect: command.screenRect,
      });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose(): void {
      lookup.dispose();
      program.dispose();
    },
  };
}
