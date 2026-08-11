import { describe, it, expect } from 'vitest';
import { createStateCache, createTexture, unsealShaderCompilation } from '@/render/gl/index';
import { createPostChain } from '@/render/postfx/chain';
import { createFakeGL } from './fake_gl';

const PASS = 'void main() { fragColor = sampleSource(vUv); }';

function setup() {
  unsealShaderCompilation();
  const fake = createFakeGL();
  const state = createStateCache(fake.ctx);
  const input = createTexture(fake.ctx, { width: 320, height: 240 });
  return { fake, state, input };
}

describe('postfx/chain', () => {
  it('パス数だけドローコールが出る', () => {
    const { fake, state, input } = setup();
    const chain = createPostChain(fake.ctx, state, [
      { name: 'a', fragmentSource: PASS },
      { name: 'b', fragmentSource: PASS },
      { name: 'c', fragmentSource: PASS },
    ]);
    chain.run(input, 640, 480);
    expect(fake.callsOf('drawArrays')).toHaveLength(3);
    expect(chain.lastPassCount).toBe(3);
  });

  it('中間 FBO を経由し、最後のパスだけ画面へ出す', () => {
    const { fake, state, input } = setup();
    const chain = createPostChain(fake.ctx, state, [
      { name: 'a', fragmentSource: PASS },
      { name: 'b', fragmentSource: PASS },
    ]);
    fake.calls.length = 0;
    chain.run(input, 640, 480);

    const binds = fake.callsOf('bindFramebuffer');
    // 1 パス目は中間 FBO、2 パス目（最後）は既定のフレームバッファ(null)
    expect(binds.at(-1)?.args[1]).toBeNull();
    expect(binds.some((c) => c.args[1] !== null)).toBe(true);

    // 画面のビューポートは screen サイズ
    const viewport = fake.callsOf('viewport').at(-1);
    expect(viewport?.args.slice(2)).toEqual([640, 480]);
  });

  it('中間 FBO は 2 枚だけで、パスを増やしても増えない（ピンポン）', () => {
    const { fake, state, input } = setup();
    const chain = createPostChain(fake.ctx, state, [
      { name: 'a', fragmentSource: PASS },
      { name: 'b', fragmentSource: PASS },
      { name: 'c', fragmentSource: PASS },
      { name: 'd', fragmentSource: PASS },
    ]);
    expect(fake.callsOf('createFramebuffer')).toHaveLength(2);
    fake.calls.length = 0;
    chain.run(input, 640, 480);
    chain.run(input, 640, 480);
    expect(fake.callsOf('createFramebuffer')).toHaveLength(0);
  });

  it('enabled が false のパスは飛ばす（品質設定 Off）', () => {
    const { fake, state, input } = setup();
    let crtOn = true;
    const chain = createPostChain(fake.ctx, state, [
      { name: 'quantize', fragmentSource: PASS },
      { name: 'crt', fragmentSource: PASS, enabled: () => crtOn },
    ]);
    chain.run(input, 640, 480);
    expect(chain.lastPassCount).toBe(2);
    crtOn = false;
    chain.run(input, 640, 480);
    expect(chain.lastPassCount).toBe(1);
  });

  it('outputSize を指定したパスは中間 FBO をその解像度にする', () => {
    const { fake, state, input } = setup();
    const chain = createPostChain(fake.ctx, state, [
      { name: 'quantize', fragmentSource: PASS, outputSize: { width: 256, height: 224 } },
      { name: 'crt', fragmentSource: PASS },
    ]);
    fake.calls.length = 0;
    chain.run(input, 640, 480);
    const viewports = fake.callsOf('viewport').map((c) => c.args.slice(2));
    expect(viewports[0]).toEqual([256, 224]);
    expect(viewports.at(-1)).toEqual([640, 480]);
  });

  it('シェーダは生成時に全部コンパイルされ、run ではコンパイルしない', () => {
    const { fake, state, input } = setup();
    const chain = createPostChain(fake.ctx, state, [
      { name: 'a', fragmentSource: PASS },
      { name: 'b', fragmentSource: PASS },
    ]);
    expect(fake.callsOf('compileShader')).toHaveLength(4); // 2 パス × (頂点 + 断片)
    fake.calls.length = 0;
    chain.run(input, 640, 480);
    expect(fake.callsOf('compileShader')).toHaveLength(0);
  });
});
