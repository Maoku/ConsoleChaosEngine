/**
 * FBO（§5.3.2、上限 200 行）。
 * 4 世代分の FBO は起動時に全部作り、切替時に確保しない（§5.4.2）。
 */
import type { GLContext } from './context';
import { createTexture, type Texture, type TextureFilter, type TextureFormat } from './texture';

export interface Framebuffer {
  readonly handle: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
  readonly color: Texture;
  bind(): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface FramebufferOptions {
  width: number;
  height: number;
  format?: TextureFormat;
  filter?: TextureFilter;
  /** 深度が必要なのは PS2（Z バッファ）のみ。PS1 は深度テストを使わない */
  depth?: boolean;
}

export function createFramebuffer(ctx: GLContext, options: FramebufferOptions): Framebuffer {
  const { gl } = ctx;
  let width = options.width;
  let height = options.height;

  const color = createTexture(ctx, {
    width,
    height,
    format: options.format ?? 'rgba8',
    filter: options.filter ?? 'nearest',
  });

  const handle = gl.createFramebuffer();
  if (!handle) throw new Error('FBO を作成できない');

  let depthBuffer: WebGLRenderbuffer | null = null;

  function attach(): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, handle);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color.handle, 0);
    if (options.depth) {
      if (!depthBuffer) depthBuffer = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
    }
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`FBO が不完全: 0x${status.toString(16)} (${width}x${height})`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  attach();

  return {
    handle,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    color,
    bind(): void {
      gl.bindFramebuffer(gl.FRAMEBUFFER, handle);
      gl.viewport(0, 0, width, height);
    },
    resize(w: number, h: number): void {
      if (w === width && h === height) return;
      width = w;
      height = h;
      color.resize(w, h);
      attach();
    },
    dispose(): void {
      color.dispose();
      if (depthBuffer) gl.deleteRenderbuffer(depthBuffer);
      gl.deleteFramebuffer(handle);
    },
  };
}

/** 既定のフレームバッファ（画面）へ戻す */
export function bindScreen(ctx: GLContext, width: number, height: number): void {
  const { gl } = ctx;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, width, height);
}
