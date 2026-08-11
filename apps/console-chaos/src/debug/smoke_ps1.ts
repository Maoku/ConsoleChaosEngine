/**
 * T0-08（V1 / V2）の検証：PS1 の頂点量子化とアフィン UV。
 *
 * 奥へ長く伸びる市松模様の床を、内部解像度 320×240 で描く。
 * 遠近の効いた面ほどアフィン UV の歪みが出るため、実機らしい「テクスチャのうねり」を
 * 目視・数値の双方で確認できる。量子化の粒度とアフィンの強さはパラメータで可変。
 */
import { DEFAULT_AMBIENT, DEFAULT_DIFFUSE } from '@/render/material';
import { mat4 } from 'gl-matrix';
import {
  createBuffer,
  createFramebuffer,
  createProgram,
  createStateCache,
  createTexture,
  createVertexArray,
  type Framebuffer,
  type GLContext,
  type Program,
  type StateCache,
  type Texture,
  type VertexArray,
} from '@/render/gl/index';
import { createCamera, type Camera } from '@/render/camera';
import { createPostChain, type PostChain } from '@/render/postfx/chain';
import ps1Vertex from '@/render/shaders/ps1_vertex.glsl?raw';
import ps1Fragment from '@/render/shaders/ps1_forward.glsl?raw';

const BLIT = 'void main() { fragColor = sampleSource(snapToTexel(vUv, uSourceSize)); }';

export interface Ps1Params {
  /** 0 = 量子化なし。値が大きいほど格子が粗くなる（実機は 1〜2 相当） */
  quantizeStep: number;
  /** 0 = 遠近補正あり、1 = 完全なアフィン UV */
  affineAmount: number;
  /** カメラの上下動。頂点の跳ねを観察するために使う */
  cameraTime: number;
}

export interface SmokePs1 {
  readonly params: Ps1Params;
  draw(screenWidth: number, screenHeight: number): void;
  dispose(): void;
}

/** 市松模様（PS1 のテクスチャは 64×64 程度が主流） */
function checkerTexture(ctx: GLContext, size = 64): Texture {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dark = ((x >> 3) + (y >> 3)) % 2 === 0;
      const i = (y * size + x) * 4;
      pixels[i] = dark ? 40 : 220;
      pixels[i + 1] = dark ? 60 : 200;
      pixels[i + 2] = dark ? 90 : 170;
      pixels[i + 3] = 255;
    }
  }
  return createTexture(ctx, { width: size, height: size, filter: 'nearest', wrap: 'repeat', data: pixels });
}

export function createSmokePs1(ctx: GLContext, internalWidth = 320, internalHeight = 240): SmokePs1 {
  const { gl } = ctx;

  // 奥へ長く伸びる床。三角形 2 枚だけで強い遠近が出る
  const vertices = new Float32Array([
    // x, y, z,  nx, ny, nz,  u, v
    -4, 0, 4, 0, 1, 0, 0, 0,
    4, 0, 4, 0, 1, 0, 4, 0,
    -4, 0, -40, 0, 1, 0, 0, 16,
    4, 0, -40, 0, 1, 0, 4, 16,
  ]);
  const stride = 8 * 4;
  const vbo = createBuffer(ctx, 'vertex', vertices);
  const ibo = createBuffer(ctx, 'index', new Uint16Array([0, 1, 2, 2, 1, 3]));
  const vao: VertexArray = createVertexArray(
    ctx,
    [
      { location: 0, size: 3, buffer: vbo, strideBytes: stride, offsetBytes: 0 },
      { location: 1, size: 3, buffer: vbo, strideBytes: stride, offsetBytes: 12 },
      { location: 2, size: 2, buffer: vbo, strideBytes: stride, offsetBytes: 24 },
    ],
    { buffer: ibo, type: 'ushort' },
  );

  const program: Program = createProgram(ctx, 'ps1_forward', ps1Vertex, ps1Fragment);
  const state: StateCache = createStateCache(ctx);
  const texture = checkerTexture(ctx);
  const scene: Framebuffer = createFramebuffer(ctx, {
    width: internalWidth,
    height: internalHeight,
    depth: true,
  });
  const chain: PostChain = createPostChain(ctx, state, [{ name: 'blit', fragmentSource: BLIT }]);

  const camera: Camera = createCamera('perspective');
  const model = mat4.create();
  const params: Ps1Params = { quantizeStep: 2, affineAmount: 1, cameraTime: 0 };

  return {
    params,
    draw(screenWidth, screenHeight): void {
      // ゆっくり上下・前後に動かす。静止画では量子化の効果が分かりにくいため
      camera.position[0] = Math.sin(params.cameraTime * 0.7) * 0.6;
      camera.position[1] = 1.4 + Math.sin(params.cameraTime) * 0.25;
      camera.position[2] = 5 + Math.sin(params.cameraTime * 0.4) * 1.5;
      camera.target[0] = 0;
      camera.target[1] = 0.6;
      camera.target[2] = -8;
      camera.update(internalWidth / internalHeight);

      scene.bind();
      // PS1 は深度バッファを持たない。描画順で解決する（T0-09 の三角形ソート）
      state.apply({ depthTest: false, depthWrite: false, blend: 'none', cull: 'none' });
      state.clear(0.02, 0.02, 0.05, 1, true);
      program.use();
      program.setUniforms({
        uModel: model as Float32Array,
        uViewProjection: camera.viewProjection as Float32Array,
        uResolution: [internalWidth, internalHeight],
        uQuantizeStep: params.quantizeStep,
        uAffineAmount: params.affineAmount,
        uBaseColor: texture,
        uBaseColorFactor: [1, 1, 1, 1],
        uLightDirection: [0.3, 1, 0.5],
        // 陰影の既定値（T2-04 でシェーダの固定値を uniform にした）。検証シーンは松明を持たない
        uAmbient: DEFAULT_AMBIENT,
        uDiffuse: DEFAULT_DIFFUSE,
      });
      vao.bind();
      gl.drawElements(gl.TRIANGLES, 6, vao.indexType, 0);

      chain.run(scene.color, screenWidth, screenHeight);
    },
    dispose(): void {
      chain.dispose();
      scene.dispose();
      vao.dispose();
      vbo.dispose();
      ibo.dispose();
      texture.dispose();
      program.dispose();
    },
  };
}
