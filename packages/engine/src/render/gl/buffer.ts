/**
 * VBO / IBO / VAO（§5.3.2、上限 250 行）。
 * PS1 の三角形ソートが毎フレーム updateIndices を呼ぶため、
 * インデックスバッファは DYNAMIC_DRAW で確保できるようにする。
 */
import type { GLContext } from './context';

export type BufferUsage = 'static' | 'dynamic' | 'stream';

export interface GLBuffer {
  readonly handle: WebGLBuffer;
  readonly target: number;
  bind(): void;
  /** 既存の確保サイズに収まる場合は bufferSubData で書き戻す（再確保を避ける） */
  update(data: ArrayBufferView, offsetBytes?: number): void;
  dispose(): void;
}

export interface AttributeSpec {
  /** シェーダ側の layout(location = N) */
  location: number;
  size: 1 | 2 | 3 | 4;
  type?: 'float' | 'ubyte' | 'ushort';
  normalized?: boolean;
  strideBytes?: number;
  offsetBytes?: number;
  buffer: GLBuffer;
}

export interface VertexArray {
  readonly handle: WebGLVertexArrayObject;
  readonly indexType: number;
  bind(): void;
  /** PS1 のソート結果を毎フレームアップロードする（§5.4.3） */
  updateIndices(data: Uint16Array | Uint32Array): void;
  /** Draw an index-buffer range. firstIndex is measured in indices, not bytes. */
  drawElements(mode: number, count: number, firstIndex?: number): void;
  dispose(): void;
}

function usageEnum(gl: WebGL2RenderingContext, usage: BufferUsage): number {
  if (usage === 'dynamic') return gl.DYNAMIC_DRAW;
  if (usage === 'stream') return gl.STREAM_DRAW;
  return gl.STATIC_DRAW;
}

export function createBuffer(
  ctx: GLContext,
  target: 'vertex' | 'index' | 'uniform',
  data: ArrayBufferView | number,
  usage: BufferUsage = 'static',
): GLBuffer {
  const { gl } = ctx;
  const targetEnum =
    target === 'vertex' ? gl.ARRAY_BUFFER : target === 'index' ? gl.ELEMENT_ARRAY_BUFFER : gl.UNIFORM_BUFFER;
  const handle = gl.createBuffer();
  if (!handle) throw new Error('バッファを作成できない');
  gl.bindBuffer(targetEnum, handle);
  if (typeof data === 'number') {
    gl.bufferData(targetEnum, data, usageEnum(gl, usage));
  } else {
    gl.bufferData(targetEnum, data, usageEnum(gl, usage));
  }

  return {
    handle,
    target: targetEnum,
    bind(): void {
      gl.bindBuffer(targetEnum, handle);
    },
    update(next: ArrayBufferView, offsetBytes = 0): void {
      gl.bindBuffer(targetEnum, handle);
      gl.bufferSubData(targetEnum, offsetBytes, next);
    },
    dispose(): void {
      gl.deleteBuffer(handle);
    },
  };
}

export function createVertexArray(
  ctx: GLContext,
  attributes: AttributeSpec[],
  indices?: { buffer: GLBuffer; type: 'ushort' | 'uint' },
): VertexArray {
  const { gl } = ctx;
  const handle = gl.createVertexArray();
  if (!handle) throw new Error('VAO を作成できない');
  gl.bindVertexArray(handle);

  for (const attr of attributes) {
    attr.buffer.bind();
    gl.enableVertexAttribArray(attr.location);
    const type =
      attr.type === 'ubyte' ? gl.UNSIGNED_BYTE : attr.type === 'ushort' ? gl.UNSIGNED_SHORT : gl.FLOAT;
    gl.vertexAttribPointer(
      attr.location,
      attr.size,
      type,
      attr.normalized ?? false,
      attr.strideBytes ?? 0,
      attr.offsetBytes ?? 0,
    );
  }

  const indexBuffer = indices?.buffer;
  if (indexBuffer) indexBuffer.bind();
  gl.bindVertexArray(null);

  const indexType = indices?.type === 'uint' ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

  return {
    handle,
    indexType,
    bind(): void {
      gl.bindVertexArray(handle);
    },
    updateIndices(data: Uint16Array | Uint32Array): void {
      if (!indexBuffer) throw new Error('インデックスバッファを持たない VAO に updateIndices した');
      // **必ず自分の VAO を束縛してから書き換える。**
      // ELEMENT_ARRAY_BUFFER の束縛先は VAO の状態なので、別の VAO が束縛されたまま
      // bindBuffer すると、**その VAO のインデックスバッファが差し替わる**。
      // T1-29 で実害を確認：殻の三角形ソートが、直前に描いた床の VAO を毎フレーム壊し、
      // 以後どの世代でもその床が描かれなくなっていた（当たり判定だけが残る）
      gl.bindVertexArray(handle);
      indexBuffer.update(data);
    },
    drawElements(mode: number, count: number, firstIndex = 0): void {
      if (!indexBuffer) throw new Error('インデックスバッファを持たない VAO に drawElements した');
      gl.bindVertexArray(handle);
      const bytesPerIndex = indexType === gl.UNSIGNED_INT ? 4 : 2;
      gl.drawElements(mode, count, indexType, firstIndex * bytesPerIndex);
    },
    dispose(): void {
      gl.deleteVertexArray(handle);
    },
  };
}
