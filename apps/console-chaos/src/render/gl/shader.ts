/**
 * シェーダのコンパイル・リンク・uniform 反射・エラー整形（§5.3.2、上限 250 行）。
 *
 * シェーダは起動時に全種類を事前コンパイルする（GAME_PLAN §11.1.1 V7）。
 * 世代切替でコンパイルが走らないことを assertNoLateCompile() で担保する。
 */
import type { GLContext } from './context';
import type { Texture } from './texture';

export type UniformValue =
  | number
  | boolean
  | Float32Array
  | Int32Array
  | readonly number[]
  | Texture;

export interface Program {
  readonly handle: WebGLProgram;
  readonly name: string;
  use(): void;
  setUniforms(values: Record<string, UniformValue>): void;
  dispose(): void;
}

interface UniformInfo {
  location: WebGLUniformLocation;
  type: number;
  size: number;
  /** sampler のときだけ持つ、この uniform 専用のテクスチャユニット番号 */
  unit?: number;
}

let compilationSealed = false;

/**
 * これ以降のシェーダコンパイルを禁止する。事前コンパイル完了時に呼ぶ。
 * 世代切替でコンパイルが走らないことの担保（V7 の受け入れ条件）。
 */
export function sealShaderCompilation(): void {
  compilationSealed = true;
}

/** ロスト復帰など、意図的に再コンパイルが必要な場合のみ */
export function unsealShaderCompilation(): void {
  compilationSealed = false;
}

function formatSource(source: string): string {
  return source
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
    .join('\n');
}

function compile(gl: WebGL2RenderingContext, type: number, source: string, name: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`シェーダオブジェクトを作成できない: ${name}`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '(ログなし)';
    gl.deleteShader(shader);
    const stage = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new Error(`${name} (${stage}) のコンパイルに失敗:\n${log}\n${formatSource(source)}`);
  }
  return shader;
}

export function createProgram(
  ctx: GLContext,
  name: string,
  vertexSource: string,
  fragmentSource: string,
): Program {
  if (compilationSealed) {
    throw new Error(
      `事前コンパイル完了後にシェーダ "${name}" をコンパイルしようとした。` +
        '切替時のコンパイルは禁止（GAME_PLAN §11.1.1 V7）',
    );
  }
  const { gl } = ctx;
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource, name);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, name);
  const handle = gl.createProgram();
  if (!handle) throw new Error(`プログラムを作成できない: ${name}`);
  gl.attachShader(handle, vs);
  gl.attachShader(handle, fs);
  gl.linkProgram(handle);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(handle) ?? '(ログなし)';
    gl.deleteProgram(handle);
    throw new Error(`${name} のリンクに失敗:\n${log}`);
  }

  // uniform を反射して location を先に引いておく（毎フレームの getUniformLocation を避ける）。
  //
  // **テクスチャユニットは sampler ごとに 1 つ固定で割り当てる。**
  // 「使うたびに次の番号を取る」方式は、1 回の use() のあいだに何度も描くと番号が伸び続け、
  // MAX_TEXTURE_IMAGE_UNITS（16 のことが多い）を超えて別の絵が貼られる。
  // シェーダ 1 本が持つ sampler は数個なので、宣言順に固定してしまえば枯れない。
  const uniforms = new Map<string, UniformInfo>();
  const count = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS) as number;
  let samplers = 0;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(handle, i);
    if (!info) continue;
    const baseName = info.name.endsWith('[0]') ? info.name.slice(0, -3) : info.name;
    const location = gl.getUniformLocation(handle, info.name);
    if (!location) continue;
    const entry: UniformInfo = { location, type: info.type, size: info.size };
    if (info.type === gl.SAMPLER_2D) entry.unit = samplers++;
    uniforms.set(baseName, entry);
  }

  function setUniform(info: UniformInfo, key: string, value: UniformValue): void {
    const { location, type } = info;
    if (typeof value === 'object' && value !== null && 'handle' in value && 'target' in value) {
      const unit = info.unit ?? 0;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture((value as Texture).target, (value as Texture).handle);
      gl.uniform1i(location, unit);
      return;
    }
    if (typeof value === 'boolean') {
      gl.uniform1i(location, value ? 1 : 0);
      return;
    }
    if (typeof value === 'number') {
      if (type === gl.INT || type === gl.SAMPLER_2D || type === gl.BOOL) gl.uniform1i(location, value);
      else gl.uniform1f(location, value);
      return;
    }
    const array = value instanceof Float32Array || value instanceof Int32Array ? value : new Float32Array(value);
    switch (type) {
      case gl.FLOAT_VEC2:
        gl.uniform2fv(location, array as Float32Array);
        break;
      case gl.FLOAT_VEC3:
        gl.uniform3fv(location, array as Float32Array);
        break;
      case gl.FLOAT_VEC4:
        gl.uniform4fv(location, array as Float32Array);
        break;
      case gl.FLOAT_MAT3:
        gl.uniformMatrix3fv(location, false, array as Float32Array);
        break;
      case gl.FLOAT_MAT4:
        gl.uniformMatrix4fv(location, false, array as Float32Array);
        break;
      case gl.INT_VEC2:
        gl.uniform2iv(location, array as Int32Array);
        break;
      case gl.INT_VEC3:
        gl.uniform3iv(location, array as Int32Array);
        break;
      case gl.INT_VEC4:
        gl.uniform4iv(location, array as Int32Array);
        break;
      case gl.FLOAT:
        gl.uniform1fv(location, array as Float32Array);
        break;
      case gl.INT:
      case gl.SAMPLER_2D:
        gl.uniform1iv(location, array as Int32Array);
        break;
      default:
        throw new Error(`${name}.${key}: 未対応の uniform 型 0x${type.toString(16)}`);
    }
  }

  return {
    handle,
    name,
    use(): void {
      gl.useProgram(handle);
    },
    setUniforms(values): void {
      for (const [key, value] of Object.entries(values)) {
        const info = uniforms.get(key);
        // 最適化で消えた uniform は無視する（シェーダバリアント間で uniform 集合が異なるため）
        if (!info) continue;
        setUniform(info, key, value);
      }
    },
    dispose(): void {
      gl.deleteProgram(handle);
    },
  };
}
