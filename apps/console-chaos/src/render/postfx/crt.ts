/**
 * CRT パスの設定適用（T0-11、§5.4.5）。
 *
 * 品質 Off / Light / Full は**同じシェーダの分岐ではなく、
 * バリアントの事前コンパイル**で切り替える。起動時に Light と Full の
 * 両方をコンパイルしておき、実行時は enabled() でどちらを通すかだけを選ぶ。
 */
import type { PostPassSpec } from './chain';
import { QUALITY_VARIANTS, presetFor, type CrtPreset, type CrtQuality } from './presets';
import type { SignalKind } from '@/generation/profiles';
import crtSource from '../shaders/crt.glsl?raw';

export interface CrtOptions {
  /** 現在の映像信号系統（世代プロファイルの値）。毎フレーム評価される */
  signal: () => SignalKind;
  /** 現在の品質設定 */
  quality: () => CrtQuality;
  /** 入力の内部解像度（走査線の本数を決める） */
  contentSize: () => { width: number; height: number };
  /** 出力解像度。省略時は画面 */
  outputSize?: { width: number; height: number };
  /** プリセットの上書き（デバッグ・アクセシビリティ用） */
  override?: () => Partial<CrtPreset>;
}

function uniformsFor(options: CrtOptions): Record<string, number | [number, number]> {
  const preset: CrtPreset = { ...presetFor(options.signal()), ...(options.override?.() ?? {}) };
  const content = options.contentSize();
  return {
    uScanline: preset.scanline,
    uBleed: preset.bleed,
    uCurvature: preset.curvature,
    uBloom: preset.bloom,
    uVignette: preset.vignette,
    uNoise: preset.noise,
    uMask: preset.mask,
    uContentSize: [content.width, content.height],
  };
}

/**
 * CRT のパス群を返す。品質ごとに 1 つずつのバリアントを持ち、
 * 実行時に有効になるのは高々 1 つ。
 */
export function createCrtPasses(options: CrtOptions): PostPassSpec[] {
  return (Object.keys(QUALITY_VARIANTS) as Array<Exclude<CrtQuality, 'off'>>).map((quality) => {
    const variant = QUALITY_VARIANTS[quality];
    const spec: PostPassSpec = {
      name: `crt_${quality}`,
      fragmentSource: `${variant.defines}${crtSource}`,
      enabled: () => options.quality() === quality,
      uniforms: () => uniformsFor(options),
    };
    return options.outputSize ? { ...spec, outputSize: options.outputSize } : spec;
  });
}
