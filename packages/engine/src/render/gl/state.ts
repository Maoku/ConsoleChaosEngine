/**
 * ステートキャッシュ（§5.3.2、上限 250 行）。
 * 「同じ値の再設定を捨てる」だけ。自動的な並べ替えなどの賢さは持たない。
 */
import type { GLContext } from './context';

export interface RenderState {
  depthTest: boolean;
  depthWrite: boolean;
  blend: 'none' | 'alpha' | 'add' | 'sub';
  cull: 'none' | 'back' | 'front';
}

export const DEFAULT_STATE: RenderState = {
  depthTest: true,
  depthWrite: true,
  blend: 'none',
  cull: 'back',
};

export interface StateCache {
  apply(state: Partial<RenderState>): void;
  /** 現在値を無効化する。外部が生の gl を触った後に呼ぶ（脱出ハッチの後始末） */
  invalidate(): void;
  clear(r: number, g: number, b: number, a?: number, depth?: boolean): void;
  readonly current: Readonly<RenderState>;
}

export function createStateCache(ctx: GLContext): StateCache {
  const { gl } = ctx;
  const current: RenderState = { ...DEFAULT_STATE };
  let dirty = true;

  function applyDepthTest(value: boolean): void {
    if (value) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
  }

  function applyBlend(value: RenderState['blend']): void {
    if (value === 'none') {
      gl.disable(gl.BLEND);
      return;
    }
    gl.enable(gl.BLEND);
    switch (value) {
      case 'alpha':
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case 'add':
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        break;
      case 'sub':
        // PS1 の半透明モード（減算）に相当する
        gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        break;
    }
  }

  function applyCull(value: RenderState['cull']): void {
    if (value === 'none') {
      gl.disable(gl.CULL_FACE);
      return;
    }
    gl.enable(gl.CULL_FACE);
    gl.cullFace(value === 'back' ? gl.BACK : gl.FRONT);
  }

  function flushAll(): void {
    applyDepthTest(current.depthTest);
    gl.depthMask(current.depthWrite);
    applyBlend(current.blend);
    applyCull(current.cull);
    dirty = false;
  }

  return {
    current,
    apply(state: Partial<RenderState>): void {
      if (dirty) {
        Object.assign(current, state);
        flushAll();
        return;
      }
      if (state.depthTest !== undefined && state.depthTest !== current.depthTest) {
        current.depthTest = state.depthTest;
        applyDepthTest(state.depthTest);
      }
      if (state.depthWrite !== undefined && state.depthWrite !== current.depthWrite) {
        current.depthWrite = state.depthWrite;
        gl.depthMask(state.depthWrite);
      }
      if (state.blend !== undefined && state.blend !== current.blend) {
        current.blend = state.blend;
        applyBlend(state.blend);
      }
      if (state.cull !== undefined && state.cull !== current.cull) {
        current.cull = state.cull;
        applyCull(state.cull);
      }
    },
    invalidate(): void {
      dirty = true;
    },
    clear(r: number, g: number, b: number, a = 1, depth = true): void {
      // 深度書き込みが無効だと深度クリアが効かないため、一時的に有効化する
      const restoreDepthWrite = depth && !current.depthWrite;
      if (restoreDepthWrite) gl.depthMask(true);
      gl.clearColor(r, g, b, a);
      gl.clear(gl.COLOR_BUFFER_BIT | (depth ? gl.DEPTH_BUFFER_BIT : 0));
      if (restoreDepthWrite) gl.depthMask(false);
    },
  };
}
