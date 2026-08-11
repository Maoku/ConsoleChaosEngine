/**
 * T0-04 の受け入れ確認：WebGL2 ラッパーだけで三角形を 1 枚描く。
 * ラッパーの API が実際に使える形になっているかを確かめるための足場であり、
 * ゲーム本体の描画経路（render/pipeline.ts）とは無関係。
 */
import {
  createBuffer,
  createProgram,
  createStateCache,
  createVertexArray,
  type GLContext,
  type Program,
  type StateCache,
  type VertexArray,
} from '@/render/gl/index';
import vertexSource from '@/render/shaders/smoke_triangle.vert.glsl?raw';
import fragmentSource from '@/render/shaders/smoke_triangle.frag.glsl?raw';

export interface SmokeTriangle {
  draw(scale: number): void;
  dispose(): void;
}

export function createSmokeTriangle(ctx: GLContext): SmokeTriangle {
  const { gl } = ctx;

  // x, y, r, g, b をインターリーブした 3 頂点
  const vertices = new Float32Array([
    0.0, 0.75, 0.9, 0.2, 0.2,
    -0.75, -0.6, 0.2, 0.9, 0.3,
    0.75, -0.6, 0.3, 0.4, 1.0,
  ]);
  const stride = 5 * 4;

  const vbo = createBuffer(ctx, 'vertex', vertices, 'static');
  const ibo = createBuffer(ctx, 'index', new Uint16Array([0, 1, 2]), 'dynamic');
  const vao: VertexArray = createVertexArray(
    ctx,
    [
      { location: 0, size: 2, buffer: vbo, strideBytes: stride, offsetBytes: 0 },
      { location: 1, size: 3, buffer: vbo, strideBytes: stride, offsetBytes: 8 },
    ],
    { buffer: ibo, type: 'ushort' },
  );

  const program: Program = createProgram(ctx, 'smoke_triangle', vertexSource, fragmentSource);
  const state: StateCache = createStateCache(ctx);

  return {
    draw(scale: number): void {
      state.apply({ depthTest: false, depthWrite: false, blend: 'none', cull: 'none' });
      state.clear(0.05, 0.05, 0.08, 1, false);
      program.use();
      program.setUniforms({ uScale: [scale, scale] });
      vao.bind();
      gl.drawElements(gl.TRIANGLES, 3, vao.indexType, 0);
    },
    dispose(): void {
      vao.dispose();
      vbo.dispose();
      ibo.dispose();
      program.dispose();
    },
  };
}
