/**
 * WebGL2 の最小モック。GL ラッパー（§5.3）をヘッドレスで検証するために使う。
 *
 * 実 GPU の描画結果は検証できない（それは Playwright の nightly の役割、§7.1）。
 * ここで検証するのは「ラッパーが正しい GL 呼び出し列を出すか」まで。
 */
import type { GLContext } from '@/render/gl/index';

export interface GLCall {
  fn: string;
  args: unknown[];
}

let nextId = 1;
function handle(kind: string): Record<string, unknown> {
  return { __kind: kind, __id: nextId++ };
}

export interface FakeGL {
  ctx: GLContext;
  calls: GLCall[];
  /** 指定した関数の呼び出しのみを抽出する */
  callsOf(fn: string): GLCall[];
  /** 反射させる uniform の一覧（テストごとに差し替える） */
  uniforms: Array<{ name: string; type: number; size: number }>;
}

export function createFakeGL(): FakeGL {
  const calls: GLCall[] = [];
  const uniforms: FakeGL['uniforms'] = [];

  // 実際の WebGL2 定数値をそのまま使う（型の分岐が値に依存するため）
  const constants: Record<string, number> = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ACTIVE_UNIFORMS: 0x8b86,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    UNIFORM_BUFFER: 0x8a11,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    STREAM_DRAW: 0x88e0,
    FLOAT: 0x1406,
    UNSIGNED_BYTE: 0x1401,
    UNSIGNED_SHORT: 0x1403,
    UNSIGNED_INT: 0x1405,
    INT: 0x1404,
    BOOL: 0x8b56,
    FLOAT_VEC2: 0x8b50,
    FLOAT_VEC3: 0x8b51,
    FLOAT_VEC4: 0x8b52,
    FLOAT_MAT3: 0x8b5b,
    FLOAT_MAT4: 0x8b5c,
    INT_VEC2: 0x8b53,
    INT_VEC3: 0x8b54,
    INT_VEC4: 0x8b55,
    SAMPLER_2D: 0x8b5e,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    CLAMP_TO_EDGE: 0x812f,
    REPEAT: 0x2901,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    NEAREST_MIPMAP_NEAREST: 0x2700,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    RGBA16F: 0x881a,
    HALF_FLOAT: 0x140b,
    RED: 0x1903,
    R8: 0x8229,
    DEPTH_COMPONENT: 0x1902,
    DEPTH_COMPONENT24: 0x81a6,
    FRAMEBUFFER: 0x8d40,
    RENDERBUFFER: 0x8d41,
    COLOR_ATTACHMENT0: 0x8ce0,
    DEPTH_ATTACHMENT: 0x8d00,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    DEPTH_TEST: 0x0b71,
    CULL_FACE: 0x0b44,
    BLEND: 0x0be2,
    BACK: 0x0405,
    FRONT: 0x0404,
    FUNC_ADD: 0x8006,
    FUNC_REVERSE_SUBTRACT: 0x800b,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    ONE: 1,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    TRIANGLES: 0x0004,
    LINES: 0x0001,
    MAX_TEXTURE_SIZE: 0x0d33,
    MAX_COLOR_ATTACHMENTS: 0x8cdf,
  };

  const record =
    (fn: string, result?: unknown) =>
    (...args: unknown[]): unknown => {
      calls.push({ fn, args });
      return result;
    };

  const gl: Record<string, unknown> = {
    ...constants,
    createShader: record('createShader', undefined),
    shaderSource: record('shaderSource'),
    compileShader: record('compileShader'),
    deleteShader: record('deleteShader'),
    createProgram: record('createProgram', undefined),
    attachShader: record('attachShader'),
    linkProgram: record('linkProgram'),
    deleteProgram: record('deleteProgram'),
    useProgram: record('useProgram'),
    getShaderInfoLog: record('getShaderInfoLog', ''),
    getProgramInfoLog: record('getProgramInfoLog', ''),
    createBuffer: record('createBuffer', undefined),
    bindBuffer: record('bindBuffer'),
    bufferData: record('bufferData'),
    bufferSubData: record('bufferSubData'),
    deleteBuffer: record('deleteBuffer'),
    createVertexArray: record('createVertexArray', undefined),
    bindVertexArray: record('bindVertexArray'),
    deleteVertexArray: record('deleteVertexArray'),
    enableVertexAttribArray: record('enableVertexAttribArray'),
    vertexAttribPointer: record('vertexAttribPointer'),
    createTexture: record('createTexture', undefined),
    bindTexture: record('bindTexture'),
    activeTexture: record('activeTexture'),
    texImage2D: record('texImage2D'),
    texParameteri: record('texParameteri'),
    generateMipmap: record('generateMipmap'),
    deleteTexture: record('deleteTexture'),
    createFramebuffer: record('createFramebuffer', undefined),
    bindFramebuffer: record('bindFramebuffer'),
    framebufferTexture2D: record('framebufferTexture2D'),
    framebufferRenderbuffer: record('framebufferRenderbuffer'),
    createRenderbuffer: record('createRenderbuffer', undefined),
    bindRenderbuffer: record('bindRenderbuffer'),
    renderbufferStorage: record('renderbufferStorage'),
    deleteRenderbuffer: record('deleteRenderbuffer'),
    deleteFramebuffer: record('deleteFramebuffer'),
    checkFramebufferStatus: record('checkFramebufferStatus', constants['FRAMEBUFFER_COMPLETE']),
    viewport: record('viewport'),
    enable: record('enable'),
    disable: record('disable'),
    depthMask: record('depthMask'),
    blendFunc: record('blendFunc'),
    blendEquation: record('blendEquation'),
    cullFace: record('cullFace'),
    clearColor: record('clearColor'),
    clear: record('clear'),
    drawElements: record('drawElements'),
    drawArrays: record('drawArrays'),
    uniform1i: record('uniform1i'),
    uniform1f: record('uniform1f'),
    uniform1iv: record('uniform1iv'),
    uniform1fv: record('uniform1fv'),
    uniform2fv: record('uniform2fv'),
    uniform3fv: record('uniform3fv'),
    uniform4fv: record('uniform4fv'),
    uniform2iv: record('uniform2iv'),
    uniform3iv: record('uniform3iv'),
    uniform4iv: record('uniform4iv'),
    uniformMatrix3fv: record('uniformMatrix3fv'),
    uniformMatrix4fv: record('uniformMatrix4fv'),
  };

  // ハンドルを返す生成系は個別に差し替える
  gl['createShader'] = (type: number) => {
    calls.push({ fn: 'createShader', args: [type] });
    return handle('shader');
  };
  gl['createProgram'] = () => {
    calls.push({ fn: 'createProgram', args: [] });
    return handle('program');
  };
  gl['createBuffer'] = () => {
    calls.push({ fn: 'createBuffer', args: [] });
    return handle('buffer');
  };
  gl['createVertexArray'] = () => {
    calls.push({ fn: 'createVertexArray', args: [] });
    return handle('vao');
  };
  gl['createTexture'] = () => {
    calls.push({ fn: 'createTexture', args: [] });
    return handle('texture');
  };
  gl['createFramebuffer'] = () => {
    calls.push({ fn: 'createFramebuffer', args: [] });
    return handle('framebuffer');
  };
  gl['createRenderbuffer'] = () => {
    calls.push({ fn: 'createRenderbuffer', args: [] });
    return handle('renderbuffer');
  };
  gl['getShaderParameter'] = () => true;
  gl['getProgramParameter'] = (_p: unknown, pname: number) => {
    if (pname === constants['ACTIVE_UNIFORMS']) return uniforms.length;
    return true;
  };
  gl['getActiveUniform'] = (_p: unknown, index: number) => uniforms[index];
  gl['getUniformLocation'] = (_p: unknown, name: string) => ({ __kind: 'location', name });
  gl['getParameter'] = (pname: number) => (pname === constants['MAX_TEXTURE_SIZE'] ? 4096 : 8);
  gl['getExtension'] = () => null;

  const ctx: GLContext = {
    gl: gl as unknown as WebGL2RenderingContext,
    canvas: { width: 640, height: 480 } as HTMLCanvasElement,
    caps: { maxTextureSize: 4096, maxColorAttachments: 8, float: false },
    onRestored: () => {},
    lost: false,
  };

  return {
    ctx,
    calls,
    callsOf: (fn) => calls.filter((c) => c.fn === fn),
    uniforms,
  };
}
