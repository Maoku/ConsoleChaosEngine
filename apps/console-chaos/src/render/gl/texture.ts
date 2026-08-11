/**
 * 2D テクスチャ（§5.3.2、上限 250 行）。
 * フィルタは世代表現の一部（FC/SFC/PS1 は nearest、PS2 は linear）なので明示的に指定させる。
 */
import type { GLContext } from './context';

export type TextureFilter = 'nearest' | 'linear';
export type TextureWrap = 'clamp' | 'repeat';
export type TextureFormat = 'rgba8' | 'rgba16f' | 'r8' | 'depth24';

export interface Texture {
  readonly handle: WebGLTexture;
  readonly target: number;
  readonly format: TextureFormat;
  width: number;
  height: number;
  bind(unit: number): void;
  upload(data: TexImageSource | ArrayBufferView | null, width?: number, height?: number): void;
  resize(width: number, height: number): void;
  setFilter(filter: TextureFilter): void;
  dispose(): void;
}

export interface TextureOptions {
  width: number;
  height: number;
  format?: TextureFormat;
  filter?: TextureFilter;
  wrap?: TextureWrap;
  mipmap?: boolean;
  /** 画像の上下を入れ替えて読む。UV の v=0 を下端にしたいとき（画像から作る場合）に使う */
  flipY?: boolean;
  data?: TexImageSource | ArrayBufferView | null;
}

interface FormatSpec {
  internal: number;
  format: number;
  type: number;
}

function formatSpec(gl: WebGL2RenderingContext, format: TextureFormat): FormatSpec {
  switch (format) {
    case 'rgba8':
      return { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    case 'rgba16f':
      return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    case 'r8':
      return { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE };
    case 'depth24':
      return { internal: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT };
  }
}

function glFilter(gl: WebGL2RenderingContext, filter: TextureFilter, mipmap: boolean): number {
  if (filter === 'nearest') return mipmap ? gl.NEAREST_MIPMAP_NEAREST : gl.NEAREST;
  return mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR;
}

export function createTexture(ctx: GLContext, options: TextureOptions): Texture {
  const { gl } = ctx;
  const format = options.format ?? 'rgba8';
  const filter = options.filter ?? 'nearest';
  const wrap = options.wrap ?? 'clamp';
  const mipmap = options.mipmap ?? false;
  const flipY = options.flipY ?? false;
  const spec = formatSpec(gl, format);
  const handle = gl.createTexture();
  if (!handle) throw new Error('テクスチャを作成できない');

  const wrapMode = wrap === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT;
  let width = options.width;
  let height = options.height;

  function isBufferView(d: unknown): d is ArrayBufferView {
    return ArrayBuffer.isView(d as ArrayBufferView);
  }

  function upload(
    data: TexImageSource | ArrayBufferView | null,
    w = width,
    h = height,
  ): void {
    width = w;
    height = h;
    gl.bindTexture(gl.TEXTURE_2D, handle);
    if (flipY) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (data === null || isBufferView(data)) {
      gl.texImage2D(
        gl.TEXTURE_2D, 0, spec.internal, w, h, 0, spec.format, spec.type,
        data as ArrayBufferView | null,
      );
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, spec.internal, spec.format, spec.type, data);
    }
    if (mipmap) gl.generateMipmap(gl.TEXTURE_2D);
    // 他のアップロード（FBO・量子化パス）へ影響を残さない
    if (flipY) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, glFilter(gl, filter, mipmap));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, glFilter(gl, filter, false));
  upload(options.data ?? null, width, height);

  return {
    handle,
    target: gl.TEXTURE_2D,
    format,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    bind(unit: number): void {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, handle);
    },
    upload,
    resize(w: number, h: number): void {
      if (w === width && h === height) return;
      upload(null, w, h);
    },
    setFilter(next: TextureFilter): void {
      gl.bindTexture(gl.TEXTURE_2D, handle);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, glFilter(gl, next, mipmap));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, glFilter(gl, next, false));
    },
    dispose(): void {
      gl.deleteTexture(handle);
    },
  };
}
