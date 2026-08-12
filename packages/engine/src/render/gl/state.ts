/** Value-compared WebGL render-state cache. */
import type { GLContext } from './context';

export type BlendEquation = 'add' | 'subtract' | 'reverse-subtract';
export type BlendFactor =
  | 'zero' | 'one'
  | 'source-color' | 'one-minus-source-color'
  | 'destination-color' | 'one-minus-destination-color'
  | 'source-alpha' | 'one-minus-source-alpha'
  | 'destination-alpha' | 'one-minus-destination-alpha'
  | 'constant-color' | 'one-minus-constant-color'
  | 'constant-alpha' | 'one-minus-constant-alpha';

export interface BlendState {
  enabled: boolean;
  equationRgb: BlendEquation;
  equationAlpha: BlendEquation;
  sourceRgb: BlendFactor;
  destinationRgb: BlendFactor;
  sourceAlpha: BlendFactor;
  destinationAlpha: BlendFactor;
  constantColor: readonly [number, number, number, number];
}

export function createBlendState(overrides: Partial<BlendState> = {}): BlendState {
  return {
    enabled: false,
    equationRgb: 'add',
    equationAlpha: 'add',
    sourceRgb: 'one',
    destinationRgb: 'zero',
    sourceAlpha: 'one',
    destinationAlpha: 'zero',
    constantColor: [0, 0, 0, 0],
    ...overrides,
  };
}

export const BLEND_NONE = createBlendState();
export const BLEND_ALPHA = createBlendState({
  enabled: true,
  sourceRgb: 'source-alpha',
  destinationRgb: 'one-minus-source-alpha',
  destinationAlpha: 'one-minus-source-alpha',
});
export const BLEND_ADD = createBlendState({
  enabled: true,
  sourceRgb: 'source-alpha',
  destinationRgb: 'one',
  destinationAlpha: 'one',
});
export const BLEND_SUBTRACT = createBlendState({
  enabled: true,
  equationRgb: 'reverse-subtract',
  sourceRgb: 'source-alpha',
  destinationRgb: 'one',
  destinationAlpha: 'one',
});

export interface RenderState {
  depthTest: boolean;
  depthWrite: boolean;
  blend: BlendState;
  cull: 'none' | 'back' | 'front';
}

export const DEFAULT_STATE: RenderState = {
  depthTest: true,
  depthWrite: true,
  blend: BLEND_NONE,
  cull: 'back',
};

export interface StateCache {
  apply(state: Partial<RenderState>): void;
  invalidate(): void;
  clear(r: number, g: number, b: number, a?: number, depth?: boolean): void;
  readonly current: Readonly<RenderState>;
}

const blendFields: readonly (keyof Omit<BlendState, 'constantColor'>)[] = [
  'enabled', 'equationRgb', 'equationAlpha', 'sourceRgb', 'destinationRgb', 'sourceAlpha', 'destinationAlpha',
];

function blendEquals(left: BlendState, right: BlendState): boolean {
  return blendFields.every((field) => left[field] === right[field])
    && left.constantColor.every((value, index) => value === right.constantColor[index]);
}

function copyBlend(target: BlendState, source: BlendState): void {
  for (const field of blendFields) {
    (target[field] as BlendState[typeof field]) = source[field];
  }
  const color = target.constantColor as [number, number, number, number];
  for (let index = 0; index < 4; index++) color[index] = source.constantColor[index] ?? 0;
}

export function createStateCache(ctx: GLContext): StateCache {
  const { gl } = ctx;
  const current: RenderState = {
    ...DEFAULT_STATE,
    blend: createBlendState(),
  };
  let dirty = true;

  const equationEnum = (value: BlendEquation): number => {
    if (value === 'subtract') return gl.FUNC_SUBTRACT;
    if (value === 'reverse-subtract') return gl.FUNC_REVERSE_SUBTRACT;
    return gl.FUNC_ADD;
  };
  const factorEnum = (value: BlendFactor): number => ({
    zero: gl.ZERO,
    one: gl.ONE,
    'source-color': gl.SRC_COLOR,
    'one-minus-source-color': gl.ONE_MINUS_SRC_COLOR,
    'destination-color': gl.DST_COLOR,
    'one-minus-destination-color': gl.ONE_MINUS_DST_COLOR,
    'source-alpha': gl.SRC_ALPHA,
    'one-minus-source-alpha': gl.ONE_MINUS_SRC_ALPHA,
    'destination-alpha': gl.DST_ALPHA,
    'one-minus-destination-alpha': gl.ONE_MINUS_DST_ALPHA,
    'constant-color': gl.CONSTANT_COLOR,
    'one-minus-constant-color': gl.ONE_MINUS_CONSTANT_COLOR,
    'constant-alpha': gl.CONSTANT_ALPHA,
    'one-minus-constant-alpha': gl.ONE_MINUS_CONSTANT_ALPHA,
  })[value];

  function applyDepthTest(value: boolean): void {
    if (value) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
  }

  function applyBlend(value: BlendState): void {
    if (!value.enabled) {
      gl.disable(gl.BLEND);
      return;
    }
    gl.enable(gl.BLEND);
    gl.blendEquationSeparate(equationEnum(value.equationRgb), equationEnum(value.equationAlpha));
    gl.blendFuncSeparate(
      factorEnum(value.sourceRgb),
      factorEnum(value.destinationRgb),
      factorEnum(value.sourceAlpha),
      factorEnum(value.destinationAlpha),
    );
    gl.blendColor(...value.constantColor);
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
    apply(next: Partial<RenderState>): void {
      if (dirty) {
        if (next.depthTest !== undefined) current.depthTest = next.depthTest;
        if (next.depthWrite !== undefined) current.depthWrite = next.depthWrite;
        if (next.blend !== undefined) copyBlend(current.blend, next.blend);
        if (next.cull !== undefined) current.cull = next.cull;
        flushAll();
        return;
      }
      if (next.depthTest !== undefined && next.depthTest !== current.depthTest) {
        current.depthTest = next.depthTest;
        applyDepthTest(next.depthTest);
      }
      if (next.depthWrite !== undefined && next.depthWrite !== current.depthWrite) {
        current.depthWrite = next.depthWrite;
        gl.depthMask(next.depthWrite);
      }
      if (next.blend !== undefined && !blendEquals(next.blend, current.blend)) {
        copyBlend(current.blend, next.blend);
        applyBlend(current.blend);
      }
      if (next.cull !== undefined && next.cull !== current.cull) {
        current.cull = next.cull;
        applyCull(next.cull);
      }
    },
    invalidate(): void {
      dirty = true;
    },
    clear(r: number, g: number, b: number, a = 1, depth = true): void {
      const restoreDepthWrite = depth && !current.depthWrite;
      if (restoreDepthWrite) gl.depthMask(true);
      gl.clearColor(r, g, b, a);
      gl.clear(gl.COLOR_BUFFER_BIT | (depth ? gl.DEPTH_BUFFER_BIT : 0));
      if (restoreDepthWrite) gl.depthMask(false);
    },
  };
}
