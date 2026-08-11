import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBuffer,
  createProgram,
  createStateCache,
  createFramebuffer,
  createTexture,
  createVertexArray,
  sealShaderCompilation,
  unsealShaderCompilation,
} from '@/render/gl/index';
import { createSmokeTriangle } from '@/debug/smoke_triangle';
import { createFakeGL } from './fake_gl';

const VS = '#version 300 es\nvoid main(){gl_Position=vec4(0);}';
const FS = '#version 300 es\nvoid main(){}';

describe('gl/shader', () => {
  beforeEach(() => unsealShaderCompilation());

  it('頂点・フラグメントをコンパイルしてリンクする', () => {
    const fake = createFakeGL();
    const program = createProgram(fake.ctx, 'test', VS, FS);
    expect(fake.callsOf('compileShader')).toHaveLength(2);
    expect(fake.callsOf('linkProgram')).toHaveLength(1);
    // コンパイル済みシェーダはリンク後に解放する
    expect(fake.callsOf('deleteShader')).toHaveLength(2);
    program.use();
    expect(fake.callsOf('useProgram')).toHaveLength(1);
  });

  it('uniform を反射し、型に応じた setter を呼ぶ', () => {
    const fake = createFakeGL();
    fake.uniforms.push(
      { name: 'uScale', type: 0x8b50, size: 1 }, // vec2
      { name: 'uMvp', type: 0x8b5c, size: 1 }, // mat4
      { name: 'uCount', type: 0x1404, size: 1 }, // int
    );
    const program = createProgram(fake.ctx, 'test', VS, FS);
    program.use();
    program.setUniforms({ uScale: [1, 2], uMvp: new Float32Array(16), uCount: 3 });
    expect(fake.callsOf('uniform2fv')).toHaveLength(1);
    expect(fake.callsOf('uniformMatrix4fv')).toHaveLength(1);
    expect(fake.callsOf('uniform1i')).toHaveLength(1);
  });

  it('テクスチャユニットは sampler ごとに固定で、何度描いても伸びない', () => {
    const fake = createFakeGL();
    fake.uniforms.push(
      { name: 'uBaseColor', type: 0x8b5e, size: 1 }, // sampler2D
      { name: 'uSecond', type: 0x8b5e, size: 1 }, // sampler2D
    );
    const program = createProgram(fake.ctx, 'test', VS, FS);
    const texture = { handle: {}, target: 0x0de1 } as unknown as Parameters<typeof program.setUniforms>[0][string];
    program.use();
    // 1 回の use() のあいだに何度も描く（本編は 60 個以上の要素を 1 回の use() で描く）
    for (let i = 0; i < 40; i++) program.setUniforms({ uBaseColor: texture, uSecond: texture });

    const units = fake.callsOf('activeTexture').map((call) => (call.args[0] as number) - 0x84c0);
    // 宣言順に 0 と 1 だけ。伸び続けると MAX_TEXTURE_IMAGE_UNITS（16 が普通）を超えて別の絵が貼られる
    expect([...new Set(units)].sort()).toEqual([0, 1]);
    expect(Math.max(...units)).toBeLessThan(16);
  });

  it('存在しない uniform は黙って無視する（シェーダバリアント間の差を吸収する）', () => {
    const fake = createFakeGL();
    const program = createProgram(fake.ctx, 'test', VS, FS);
    program.use();
    expect(() => program.setUniforms({ uNotThere: 1 })).not.toThrow();
  });

  it('事前コンパイル完了後のコンパイルは失敗する（V7 の担保）', () => {
    const fake = createFakeGL();
    sealShaderCompilation();
    expect(() => createProgram(fake.ctx, 'late', VS, FS)).toThrow(/事前コンパイル完了後/);
  });
});

describe('gl/state', () => {
  it('同じ値の再設定を捨てる', () => {
    const fake = createFakeGL();
    const state = createStateCache(fake.ctx);
    state.apply({ depthTest: true, blend: 'alpha', cull: 'back' });
    const afterFirst = fake.calls.length;
    state.apply({ depthTest: true, blend: 'alpha', cull: 'back' });
    expect(fake.calls.length).toBe(afterFirst);
  });

  it('変わった値だけを GL に流す', () => {
    const fake = createFakeGL();
    const state = createStateCache(fake.ctx);
    state.apply({ depthTest: true, depthWrite: true, blend: 'none', cull: 'back' });
    const before = fake.callsOf('depthMask').length;
    state.apply({ depthWrite: false });
    expect(fake.callsOf('depthMask').length).toBe(before + 1);
    expect(state.current.depthWrite).toBe(false);
  });

  it('PS1 の減算半透明は FUNC_REVERSE_SUBTRACT になる', () => {
    const fake = createFakeGL();
    const state = createStateCache(fake.ctx);
    state.apply({ blend: 'sub' });
    const eq = fake.callsOf('blendEquation').at(-1);
    expect(eq?.args[0]).toBe(0x800b);
  });
});

describe('gl/buffer', () => {
  /**
   * T1-29 の回帰。ELEMENT_ARRAY_BUFFER の束縛先は VAO の状態なので、
   * **他の VAO が束縛されたまま書き換えると、その VAO のインデックスが差し替わる**。
   * 実際に殻の三角形ソートが、直前に描いた床の VAO を毎フレーム壊していた。
   */
  it('updateIndices は自分の VAO を束縛してから書き換える', () => {
    const fake = createFakeGL();
    const vertices = createBuffer(fake.ctx, 'vertex', new Float32Array(9));
    const indices = createBuffer(fake.ctx, 'index', new Uint16Array([0, 1, 2]), 'dynamic');
    const vao = createVertexArray(fake.ctx, [{ location: 0, size: 3, buffer: vertices }], {
      buffer: indices,
      type: 'ushort',
    });

    const before = fake.calls.length;
    vao.updateIndices(new Uint16Array([2, 1, 0]));
    const after = fake.calls.slice(before).map((call) => call.fn);

    // 「VAO を束縛 → インデックスを束縛 → 書き込み」の順であること
    expect(after.indexOf('bindVertexArray')).toBe(0);
    expect(after.indexOf('bindBuffer')).toBeGreaterThan(0);
    expect(after.indexOf('bufferSubData')).toBeGreaterThan(after.indexOf('bindBuffer'));
  });
});

describe('gl/framebuffer', () => {
  it('カラーテクスチャを添付し、完全性を確認する', () => {
    const fake = createFakeGL();
    const fbo = createFramebuffer(fake.ctx, { width: 320, height: 240, depth: true });
    expect(fbo.width).toBe(320);
    expect(fake.callsOf('framebufferTexture2D')).toHaveLength(1);
    expect(fake.callsOf('renderbufferStorage')).toHaveLength(1);
    expect(fake.callsOf('checkFramebufferStatus')).toHaveLength(1);
  });

  it('同じサイズへの resize は何もしない', () => {
    const fake = createFakeGL();
    const fbo = createFramebuffer(fake.ctx, { width: 256, height: 224 });
    const before = fake.calls.length;
    fbo.resize(256, 224);
    expect(fake.calls.length).toBe(before);
    fbo.resize(320, 240);
    expect(fake.calls.length).toBeGreaterThan(before);
  });
});

describe('gl/texture', () => {
  it('フィルタ指定が GL に伝わる（世代表現の一部）', () => {
    const fake = createFakeGL();
    createTexture(fake.ctx, { width: 8, height: 8, filter: 'nearest' });
    const magFilter = fake
      .callsOf('texParameteri')
      .find((c) => c.args[1] === 0x2800);
    expect(magFilter?.args[2]).toBe(0x2600); // NEAREST
  });
});

describe('T0-04 受け入れ: 三角形が 1 枚描ける', () => {
  it('VAO・プログラム・ドローコールが揃う', () => {
    const fake = createFakeGL();
    unsealShaderCompilation();
    fake.uniforms.push({ name: 'uScale', type: 0x8b50, size: 1 });
    const triangle = createSmokeTriangle(fake.ctx);
    triangle.draw(1);

    expect(fake.callsOf('createVertexArray')).toHaveLength(1);
    expect(fake.callsOf('vertexAttribPointer')).toHaveLength(2);
    const draw = fake.callsOf('drawElements');
    expect(draw).toHaveLength(1);
    expect(draw[0]?.args[1]).toBe(3); // 頂点 3 つ
    expect(draw[0]?.args[2]).toBe(0x1403); // UNSIGNED_SHORT

    triangle.dispose();
    expect(fake.callsOf('deleteProgram')).toHaveLength(1);
  });
});
