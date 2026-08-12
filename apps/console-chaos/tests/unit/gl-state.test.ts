import { describe, expect, it } from 'vitest';
import { createBlendState, createStateCache } from '@console-chaos/engine';
import { createFakeGL } from './fake_gl';

describe('normalized GL blend state', () => {
  it('uses separate RGB/alpha equation, factors, and blend color', () => {
    const fake = createFakeGL();
    const state = createStateCache(fake.ctx);
    const blend = createBlendState({
      enabled: true,
      equationRgb: 'reverse-subtract',
      equationAlpha: 'add',
      sourceRgb: 'constant-alpha',
      destinationRgb: 'one',
      sourceAlpha: 'one',
      destinationAlpha: 'one-minus-source-alpha',
      constantColor: [0.1, 0.2, 0.3, 0.25],
    });
    state.apply({ blend });
    expect(fake.callsOf('blendEquationSeparate').at(-1)?.args).toEqual([
      fake.ctx.gl.FUNC_REVERSE_SUBTRACT,
      fake.ctx.gl.FUNC_ADD,
    ]);
    expect(fake.callsOf('blendFuncSeparate').at(-1)?.args).toEqual([
      fake.ctx.gl.CONSTANT_ALPHA,
      fake.ctx.gl.ONE,
      fake.ctx.gl.ONE,
      fake.ctx.gl.ONE_MINUS_SRC_ALPHA,
    ]);
    expect(fake.callsOf('blendColor').at(-1)?.args).toEqual([0.1, 0.2, 0.3, 0.25]);
  });

  it('compares blend state by value and only reapplies when a field changes', () => {
    const fake = createFakeGL();
    const state = createStateCache(fake.ctx);
    state.apply({ blend: createBlendState({ enabled: true, sourceRgb: 'one', destinationRgb: 'one' }) });
    const calls = fake.callsOf('blendFuncSeparate').length;
    state.apply({ blend: createBlendState({ enabled: true, sourceRgb: 'one', destinationRgb: 'one' }) });
    expect(fake.callsOf('blendFuncSeparate')).toHaveLength(calls);
    state.apply({ blend: createBlendState({ enabled: true, sourceRgb: 'one', destinationRgb: 'zero' }) });
    expect(fake.callsOf('blendFuncSeparate')).toHaveLength(calls + 1);
  });
});
