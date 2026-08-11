/**
 * 固定のフルスクリーンパス列（IMPLEMENTATION_PLAN §5.4.5）。
 *
 * 汎用の Composer / エフェクトグラフは作らない（§1.3）。
 * パスは配列で与えられた順に必ず実行され、依存関係の解決も並べ替えもしない。
 *
 *   [世代別レンダリング結果 FBO]
 *      → (FC/SFC のみ) 量子化パス
 *      → 共通スケーリング
 *      → CRT パス
 *      → TV フレーム合成
 *      → 画面
 */
import {
  bindScreen,
  createFramebuffer,
  createProgram,
  type Framebuffer,
  type GLContext,
  type Program,
  type StateCache,
  type Texture,
  type TextureFilter,
  type UniformValue,
} from '../gl/index';
import fullscreenVert from '../shaders/fullscreen.vert';
import commonGlsl from '../shaders/common';

export interface PostPassSpec {
  name: string;
  /** common.glsl を暗黙に連結する。`#version` 行は書かない */
  fragmentSource: string;
  /** 出力解像度。省略時は入力と同じ解像度 */
  outputSize?: { width: number; height: number };
  /** 中間出力の拡大方法。ドット感を保つ既定は nearest */
  filter?: TextureFilter;
  /** 毎フレーム評価される追加 uniform */
  uniforms?: () => Record<string, UniformValue>;
  /** false を返す間はパスごと飛ばす（品質設定 Off 用） */
  enabled?: () => boolean;
}

export interface PostChain {
  /**
   * 入力テクスチャを受け取り、最後のパスの結果を出力先へ書く。
   * @param target 省略時は画面。指定するとその FBO へ書く（世代ブレンドで使う）
   */
  run(
    input: Texture,
    screenWidth: number,
    screenHeight: number,
    timeSeconds?: number,
    target?: Framebuffer | null,
  ): void;
  /** 最後に実行したパス数（テスト・プロファイラ用） */
  readonly lastPassCount: number;
  dispose(): void;
}

interface CompiledPass {
  spec: PostPassSpec;
  program: Program;
}

/** common.glsl を挟んだ完全なフラグメントシェーダを組み立てる */
function buildFragment(source: string): string {
  return `#version 300 es\n${commonGlsl}\n${source}`;
}

export function createPostChain(
  ctx: GLContext,
  state: StateCache,
  specs: PostPassSpec[],
): PostChain {
  const { gl } = ctx;

  // シェーダは起動時に全部コンパイルしておく（§5.3.2 / V7）
  const passes: CompiledPass[] = specs.map((spec) => ({
    spec,
    program: createProgram(ctx, `postfx:${spec.name}`, fullscreenVert, buildFragment(spec.fragmentSource)),
  }));

  // ピンポン用の中間 FBO は 2 枚だけ。パスごとに確保しない
  const scratch: [Framebuffer, Framebuffer] = [
    createFramebuffer(ctx, { width: 1, height: 1 }),
    createFramebuffer(ctx, { width: 1, height: 1 }),
  ];
  let lastPassCount = 0;

  function run(
    input: Texture,
    screenWidth: number,
    screenHeight: number,
    timeSeconds = 0,
    finalTarget: Framebuffer | null = null,
  ): void {
    const active = passes.filter((p) => p.spec.enabled?.() ?? true);
    lastPassCount = active.length;
    if (active.length === 0) return;

    // ポストプロセスは常に深度もカリングも使わない
    state.apply({ depthTest: false, depthWrite: false, blend: 'none', cull: 'none' });

    let source = input;
    let sourceWidth = input.width;
    let sourceHeight = input.height;

    active.forEach((pass, index) => {
      const isLast = index === active.length - 1;
      const outWidth = pass.spec.outputSize?.width ?? (isLast ? screenWidth : sourceWidth);
      const outHeight = pass.spec.outputSize?.height ?? (isLast ? screenHeight : sourceHeight);

      let target: Framebuffer | null = null;
      if (isLast) {
        if (finalTarget) {
          finalTarget.resize(outWidth, outHeight);
          finalTarget.bind();
        } else {
          bindScreen(ctx, screenWidth, screenHeight);
        }
      } else {
        target = scratch[index % 2] as Framebuffer;
        target.resize(outWidth, outHeight);
        if (pass.spec.filter) target.color.setFilter(pass.spec.filter);
        target.bind();
      }

      pass.program.use();
      pass.program.setUniforms({
        uSource: source,
        uSourceSize: [sourceWidth, sourceHeight],
        uOutputSize: [outWidth, outHeight],
        uTimeSeconds: timeSeconds,
        ...(pass.spec.uniforms?.() ?? {}),
      });
      // 頂点バッファなしのフルスクリーン三角形
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (target) {
        source = target.color;
        sourceWidth = target.width;
        sourceHeight = target.height;
      }
    });
  }

  return {
    run,
    get lastPassCount() {
      return lastPassCount;
    },
    dispose(): void {
      for (const pass of passes) pass.program.dispose();
      for (const fbo of scratch) fbo.dispose();
    },
  };
}
