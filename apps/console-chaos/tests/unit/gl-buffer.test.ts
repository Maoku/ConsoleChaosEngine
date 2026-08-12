import { describe, expect, it } from 'vitest';
import { createBuffer, createVertexArray } from '@console-chaos/engine';
import { createFakeGL } from './fake_gl';

describe('GL vertex array index ranges', () => {
  it('converts firstIndex to the correct ushort and uint byte offsets', () => {
    const ushort = createFakeGL();
    const ushortIndex = createBuffer(ushort.ctx, 'index', new Uint16Array(12));
    const ushortVao = createVertexArray(ushort.ctx, [], { buffer: ushortIndex, type: 'ushort' });
    ushortVao.drawElements(ushort.ctx.gl.TRIANGLES, 6, 3);
    expect(ushort.callsOf('drawElements').at(-1)?.args).toEqual([
      ushort.ctx.gl.TRIANGLES, 6, ushort.ctx.gl.UNSIGNED_SHORT, 6,
    ]);

    const uint = createFakeGL();
    const uintIndex = createBuffer(uint.ctx, 'index', new Uint32Array(12));
    const uintVao = createVertexArray(uint.ctx, [], { buffer: uintIndex, type: 'uint' });
    uintVao.drawElements(uint.ctx.gl.TRIANGLES, 6, 3);
    expect(uint.callsOf('drawElements').at(-1)?.args).toEqual([
      uint.ctx.gl.TRIANGLES, 6, uint.ctx.gl.UNSIGNED_INT, 12,
    ]);
  });
});
