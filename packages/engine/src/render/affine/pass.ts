import type { AffineSurfaceCommand, Vec2 } from '../frame';
import { BLEND_NONE, createProgram, type GLContext, type Program, type StateCache, type Texture } from '../gl/index';
import { validateAffineSurface } from './reference';
import { AFFINE_SURFACE_FRAGMENT, AFFINE_SURFACE_VERTEX } from './shader';

export interface AffineSurfacePass {
  draw(command: AffineSurfaceCommand, source: Texture, resolution: Vec2): void;
  dispose(): void;
}

export function createAffineSurfacePass(ctx: GLContext, state: StateCache): AffineSurfacePass {
  const { gl } = ctx;
  const program: Program = createProgram(ctx, 'affine-surface', AFFINE_SURFACE_VERTEX, AFFINE_SURFACE_FRAGMENT);
  return {
    draw(command, source, resolution): void {
      validateAffineSurface(command, resolution);
      state.apply({ depthTest: false, depthWrite: false, blend: BLEND_NONE, cull: 'none' });
      program.use();
      gl.bindVertexArray(null);
      program.setUniforms({
        uSource: source,
        uResolution: resolution,
        uScreenRect: command.screenRect,
        uUvOrigin: command.uvOrigin,
        uUvStepX: command.uvStepX,
        uUvStepY: command.uvStepY,
        uRepeat: (command.wrap ?? 'repeat') === 'repeat',
      });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose: () => program.dispose(),
  };
}
