/**
 * 世代別の CRT プリセット（T0-11、§5.4.5、GAME_PLAN §8）。
 *
 * 4 世代の違いは「別のシェーダ」ではなく**同じシェーダに与える値の違い**である。
 * 世代が進むほど信号が良くなり、にじみ・ざらつきが減って輪郭が立つ。
 * これがプレイヤーに「時代が進んだ」と感じさせる主要因になる。
 *
 * ここは定数テーブルのみ。ロジックは crt.ts。
 */
import type { GenerationId, SignalKind } from '../../generation/profiles';

export interface CrtPreset {
  /** 走査線の暗さ 0..1 */
  scanline: number;
  /** 色のにじみ（横方向）0..1 */
  bleed: number;
  /** 画面の樽型歪み 0..1 */
  curvature: number;
  /** 明部のにじみ出し 0..1 */
  bloom: number;
  /** 周辺減光 0..1 */
  vignette: number;
  /** ざらつき 0..1 */
  noise: number;
  /** 蛍光体マスクの強さ 0..1 */
  mask: number;
}

/** 映像信号の系統ごとのプリセット。世代 ID ではなく信号で引く */
export const SIGNAL_PRESETS: Record<SignalKind, CrtPreset> = {
  // RF：もっとも劣化が大きい。色がにじみ、ざらつきが乗る
  rf: { scanline: 0.32, bleed: 0.85, curvature: 1.0, bloom: 0.35, vignette: 0.55, noise: 0.055, mask: 0.5 },
  // コンポジット：にじみは残るがざらつきは減る
  composite: { scanline: 0.28, bleed: 0.55, curvature: 0.85, bloom: 0.28, vignette: 0.45, noise: 0.025, mask: 0.42 },
  // S 端子：輝度と色が分離し、輪郭が立つ
  svideo: { scanline: 0.22, bleed: 0.25, curvature: 0.6, bloom: 0.2, vignette: 0.35, noise: 0.012, mask: 0.3 },
  // コンポーネント：ほぼ素の映像。走査線と軽い減光だけが残る
  component: { scanline: 0.14, bleed: 0.08, curvature: 0.35, bloom: 0.14, vignette: 0.22, noise: 0.004, mask: 0.18 },
};

/**
 * 世代 → プリセットの対応表。
 * 参照するのは `PROFILES[id].video.signal` であり、世代 ID で分岐はしない。
 */
export function presetFor(signal: SignalKind): CrtPreset {
  return SIGNAL_PRESETS[signal];
}

export type CrtQuality = 'off' | 'light' | 'full';

/**
 * 品質設定ごとの説明（設定画面と、低スペック機での既定値の選択に使う）。
 * 分岐ではなくシェーダバリアントで切り替えるため、ここには「どのバリアントか」だけを持つ。
 */
export const QUALITY_VARIANTS: Record<Exclude<CrtQuality, 'off'>, { defines: string; label: string }> = {
  light: { defines: '', label: '走査線と周辺減光のみ' },
  full: { defines: '#define CRT_FULL 1\n', label: '歪み・にじみ・ブルーム・マスク・ざらつき' },
};

/** 世代を跨いでも変えない、CRT の外側の見え（TV フレーム）に関する定数 */
export const SCREEN_SAFE_AREA = {
  /** 4:3 のセーフエリア比率。HUD はこの外側に置く（§5.4.5 / T1-18） */
  aspect: 4 / 3,
  overscan: 0.04,
} as const;

/** 世代 ID から信号系統を引くための対応（profiles.ts の値をそのまま使う） */
export type GenerationSignals = Record<GenerationId, SignalKind>;
