/**
 * WebGL2 ラッパーの公開 API（§5.3.2、上限 100 行）。
 * ここが render/ 以下から見える唯一の入口。合計 1,500 行を上限とする（§5.3.3）。
 */
export { createGLContext } from './context';
export type { GLContext, GLCaps, GLContextOptions } from './context';

export { createProgram, sealShaderCompilation, unsealShaderCompilation } from './shader';
export type { Program, UniformValue } from './shader';

export { createBuffer, createVertexArray } from './buffer';
export type { GLBuffer, VertexArray, AttributeSpec, BufferUsage } from './buffer';

export { createTexture } from './texture';
export type { Texture, TextureOptions, TextureFilter, TextureWrap, TextureFormat } from './texture';

export { createFramebuffer, bindScreen } from './framebuffer';
export type { Framebuffer, FramebufferOptions } from './framebuffer';

export { createStateCache, DEFAULT_STATE } from './state';
export type { StateCache, RenderState } from './state';
