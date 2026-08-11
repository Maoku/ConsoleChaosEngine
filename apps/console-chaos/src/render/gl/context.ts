/**
 * WebGL2 コンテキストの取得・機能検出・ロスト対応（§5.3.2、上限 150 行）。
 * 生の `gl` を隠さない — 脱出ハッチを常に開けておく。
 */

export interface GLCaps {
  maxTextureSize: number;
  maxColorAttachments: number;
  /** 浮動小数テクスチャへのレンダリングが可能か（CRT のブルームで使う） */
  float: boolean;
}

export interface GLContext {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  readonly caps: GLCaps;
  /** コンテキストロストからの復帰時に呼ばれる。全リソースの再作成が必要 */
  onRestored(handler: () => void): void;
  readonly lost: boolean;
}

export interface GLContextOptions {
  antialias?: boolean;
  alpha?: boolean;
  /** 実機の見えを作るのは CRT パスなので、既定では既存バッファを保持しない */
  preserveDrawingBuffer?: boolean;
}

export function createGLContext(
  canvas: HTMLCanvasElement,
  options: GLContextOptions = {},
): GLContext {
  const gl = canvas.getContext('webgl2', {
    antialias: options.antialias ?? false,
    alpha: options.alpha ?? false,
    depth: true,
    stencil: false,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    throw new Error('WebGL2 を初期化できない。対応ブラウザで開くこと。');
  }

  const caps: GLCaps = {
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    maxColorAttachments: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) as number,
    float: gl.getExtension('EXT_color_buffer_float') !== null,
  };

  const restoredHandlers: Array<() => void> = [];
  let lost = false;

  canvas.addEventListener('webglcontextlost', (e) => {
    // 既定動作を止めないと復帰イベントが飛んでこない
    e.preventDefault();
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    for (const handler of restoredHandlers) handler();
  });

  return {
    gl,
    canvas,
    caps,
    onRestored(handler) {
      restoredHandlers.push(handler);
    },
    get lost() {
      return lost;
    },
  };
}
