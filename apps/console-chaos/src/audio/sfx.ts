/**
 * 効果音一式（T1-16、GAME_PLAN §9.3）。
 *
 * **効果音の「種類」は 4 世代で同じ。変わるのは鳴り方だけ。**
 * 第1世代は 1 音 1 音が明確な意味を持ち（種類が少ないから覚えられる）、
 * 第4世代では層が重なって環境に埋もれる。この対比が §9.3 の主題であり、
 * ゲーム進行に必要な情報（解けた・戻された・強制切替が来る）は
 * どの世代でも必ず鳴る。
 *
 * 世代差は **`profile.audio` の値から導く**（不変条件 I2）:
 *
 * | 差 | 根拠となる値 | 効果 |
 * |---|---|---|
 * | 音程変化の粗さ | `sampleRate === 0`（合成のみ） | 掃引を 3 段の階段で表す。サンプルを持つ世代は 6 段 |
 * | 層の数 | `channels` | 24 声で 2 層、48 声で 3 層。厚くなるほど輪郭が甘くなる |
 * | 余韻 | `reverb` | 残響のある世代は尾を伸ばす |
 * | 定位 | `positional` | 鳴った場所へ振る。持たない世代は中央 |
 */
import type { GenerationProfile } from '@/generation/profiles';
import type { PlayRequest } from './engine';
import { pitchToFrequency } from './score';

export type SfxId =
  | 'jump'
  | 'land'
  | 'attack'
  | 'switch'
  | 'solve'
  | 'checkpoint'
  | 'respawn'
  | 'deny'
  | 'warning'
  | 'hint';

interface SfxDefinition {
  /** 開始・終了のノート番号。上がるか下がるかが「意味」を担う */
  fromPitch: number;
  toPitch: number;
  durationSeconds: number;
  velocity: number;
}

/**
 * 効果音の定義。**上昇 = 前へ進んだ / 下降 = 差し戻された**で統一する。
 * 第1世代でも 10 種を聞き分けられるよう、音域と長さを重ならせない。
 */
export const SFX: Record<SfxId, SfxDefinition> = {
  jump: { fromPitch: 72, toPitch: 84, durationSeconds: 0.12, velocity: 0.7 },
  land: { fromPitch: 60, toPitch: 48, durationSeconds: 0.1, velocity: 0.5 },
  attack: { fromPitch: 86, toPitch: 74, durationSeconds: 0.08, velocity: 0.8 },
  switch: { fromPitch: 60, toPitch: 96, durationSeconds: 0.3, velocity: 0.8 },
  solve: { fromPitch: 72, toPitch: 91, durationSeconds: 0.5, velocity: 0.9 },
  checkpoint: { fromPitch: 76, toPitch: 88, durationSeconds: 0.35, velocity: 0.7 },
  respawn: { fromPitch: 84, toPitch: 60, durationSeconds: 0.3, velocity: 0.7 },
  deny: { fromPitch: 55, toPitch: 47, durationSeconds: 0.18, velocity: 0.6 },
  /** 強制切替の予告（GAME_PLAN §5.4 の「下降するアラート音」） */
  warning: { fromPitch: 88, toPitch: 64, durationSeconds: 0.6, velocity: 0.9 },
  hint: { fromPitch: 79, toPitch: 86, durationSeconds: 0.25, velocity: 0.5 },
};

/** 掃引の段数。サンプルを持たない世代は粗い階段になる */
export function sweepSteps(profile: GenerationProfile): number {
  return profile.audio.sampleRate === 0 ? 3 : 6;
}

/** 重ねる層の数の上限 */
export const MAX_SFX_LAYERS = 3;

/** 重ねる層の数。24 声ごとに 1 層増える */
export function sfxLayers(profile: GenerationProfile): number {
  return Math.min(MAX_SFX_LAYERS, 1 + Math.floor(profile.audio.channels / 24));
}

/** 層ごとの音程差（半音）。1 層目は必ず原音 */
const LAYER_SEMITONES = [0, 12, 19];

export interface SfxOptions {
  /** 定位 -1..1。定位を持たない世代では無視される */
  pan?: number;
  /** 音量倍率 0..1 */
  gain?: number;
}

/**
 * 効果音 1 回分の発音要求を組み立てる。
 * 掃引は短い音の階段で表す（`PlayRequest` は 1 音 1 周波数のため）。
 */
export function sfxRequests(
  id: SfxId,
  profile: GenerationProfile,
  when: number,
  options: SfxOptions = {},
): PlayRequest[] {
  const definition = SFX[id];
  const steps = sweepSteps(profile);
  const layers = sfxLayers(profile);
  const total = sfxDurationSeconds(id, profile);
  const stepSeconds = total / steps;
  const pan = profile.audio.positional ? (options.pan ?? 0) : undefined;
  const gain = options.gain ?? 1;

  const requests: PlayRequest[] = [];
  for (let layer = 0; layer < layers; layer++) {
    const semitones = LAYER_SEMITONES[layer] ?? 0;
    // 層が増えるほど 1 層あたりは小さくする（合計の音量を揃える）
    const velocity = (definition.velocity * gain) / (layer + 1);
    for (let step = 0; step < steps; step++) {
      const t = steps === 1 ? 0 : step / (steps - 1);
      const pitch = definition.fromPitch + (definition.toPitch - definition.fromPitch) * t;
      requests.push({
        role: 'fx',
        frequency: pitchToFrequency(pitch + semitones),
        when: when + step * stepSeconds,
        durationSeconds: stepSeconds,
        velocity,
        ...(pan === undefined ? {} : { pan }),
      });
    }
  }
  return requests;
}

/** 効果音 1 回分の長さ（秒）。残響のある世代は尾が伸びる */
export function sfxDurationSeconds(id: SfxId, profile: GenerationProfile): number {
  return SFX[id].durationSeconds * (profile.audio.reverb ? 1.25 : 1);
}
