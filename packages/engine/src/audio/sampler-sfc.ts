/**
 * 第2世代（SFC）のサンプラ（T1-16、GAME_PLAN §9.1）。
 *
 * 実機は 8 声のサンプル再生機で、圧縮（BRR）による粗さと
 * ハードウェアのエコーが音色の性格を決めていた。ここでは
 *
 * - **1 周期の波形をサンプルとして持ち**、再生レートで音程を作る（＝サンプラ）
 * - サンプルを 4bit 相当に量子化して焼き込む（疑似 BRR）
 * - 32kHz のバッファとして作り、ブラウザのリサンプリングで帯域が落ちる
 * - ADSR エンベロープ（第1世代の「減衰のみ」との差が世代の差になる）
 * - `ConvolverNode` による短いエコー
 *
 * を再現する。**サンプルはコードで生成する**（アセットを増やさない。§12.2）。
 */
import type { GenerationVoiceSource, PlayRequest, VoiceHandle, VoiceSourceOptions } from './engine';
import type { TrackRole } from './score';

/** 1 サンプル = 波形 1 周期の長さ。短いほど実機の ROM 事情に近い */
const CYCLE_SAMPLES = 64;
/** 疑似 BRR の量子化段数（4bit = 16 段） */
export const BRR_LEVELS = 16;

interface Timbre {
  /** 倍音の強さ。添字 + 1 が倍音次数。空なら打楽器（ノイズ） */
  harmonics: readonly number[];
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

/** 役割ごとの音色。第2世代は「サンプルを差し替えれば別の楽器になる」ことが特徴 */
const TIMBRES: Record<TrackRole, Timbre> = {
  lead: { harmonics: [1, 0.5, 0.35, 0.2, 0.12], attack: 0.01, decay: 0.09, sustain: 0.65, release: 0.12 },
  bass: { harmonics: [1, 0.3, 0.12], attack: 0.005, decay: 0.12, sustain: 0.55, release: 0.08 },
  pad: { harmonics: [1, 0.6, 0.4, 0.3, 0.22, 0.15], attack: 0.08, decay: 0.2, sustain: 0.7, release: 0.35 },
  perc: { harmonics: [], attack: 0.001, decay: 0.06, sustain: 0, release: 0.05 },
  fx: { harmonics: [1, 0.25, 0.6, 0.15], attack: 0.002, decay: 0.05, sustain: 0.3, release: 0.06 },
};

/** 4bit 相当へ量子化する（BRR の粗さを波形に焼き込む） */
export function brrQuantize(value: number): number {
  const step = 2 / (BRR_LEVELS - 1);
  return Math.round(value / step) * step;
}

function cycleBuffer(ctx: BaseAudioContext, sampleRate: number, harmonics: readonly number[]): AudioBuffer {
  const buffer = ctx.createBuffer(1, CYCLE_SAMPLES, sampleRate);
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < CYCLE_SAMPLES; i++) {
    const phase = (i / CYCLE_SAMPLES) * Math.PI * 2;
    let value = 0;
    harmonics.forEach((amplitude, index) => {
      value += amplitude * Math.sin(phase * (index + 1));
    });
    data[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  for (let i = 0; i < CYCLE_SAMPLES; i++) data[i] = brrQuantize((data[i] ?? 0) / (peak || 1));
  return buffer;
}

/** 打楽器用のノイズ。決定的に作る（再生ごとに音が変わらない） */
function noiseBuffer(ctx: BaseAudioContext, sampleRate: number): AudioBuffer {
  const length = Math.max(Math.floor(sampleRate * 0.25), 128);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const decay = 1 - i / length;
    data[i] = brrQuantize((seed / 0x3fffffff - 1) * decay);
  }
  return buffer;
}

/** 短いエコー用のインパルス応答（実機のエコーバッファに相当） */
function echoImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.max(Math.floor(ctx.sampleRate * seconds), 128);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = 0x5bd1e995;
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x3fffffff - 1) * Math.pow(1 - i / length, 3);
    }
  }
  return buffer;
}

export function createSfcSampler(
  ctx: BaseAudioContext,
  destination: AudioNode,
  options: VoiceSourceOptions,
): GenerationVoiceSource {
  const sampleRate = options.sampleRate > 0 ? options.sampleRate : ctx.sampleRate;
  const output = ctx.createGain();
  output.gain.value = 0.22;
  output.connect(destination);

  // エコーは送りとして持つ（原音は必ず素で出る）
  let echoSend: GainNode | null = null;
  if (options.reverb) {
    const convolver = ctx.createConvolver();
    convolver.buffer = echoImpulse(ctx, 0.35);
    echoSend = ctx.createGain();
    echoSend.gain.value = 0.25;
    echoSend.connect(convolver);
    convolver.connect(output);
  }

  const buffers = new Map<TrackRole, AudioBuffer>();
  function sampleOf(role: TrackRole): AudioBuffer {
    let buffer = buffers.get(role);
    if (!buffer) {
      const timbre = TIMBRES[role];
      buffer =
        timbre.harmonics.length === 0
          ? noiseBuffer(ctx, sampleRate)
          : cycleBuffer(ctx, sampleRate, timbre.harmonics);
      buffers.set(role, buffer);
    }
    return buffer;
  }

  return {
    voiceLimit: options.voiceLimit,
    play(request: PlayRequest): VoiceHandle {
      const timbre = TIMBRES[request.role];
      const looped = timbre.harmonics.length > 0;

      const gain = ctx.createGain();
      gain.connect(output);
      if (echoSend) gain.connect(echoSend);

      const { when, durationSeconds, velocity } = request;
      const peak = 0.5 * velocity;
      // ADSR。第1世代の「減衰のみ」と違い、立ち上がりと保持を持つ
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(peak, when + timbre.attack);
      gain.gain.linearRampToValueAtTime(peak * timbre.sustain, when + timbre.attack + timbre.decay);
      gain.gain.setValueAtTime(peak * timbre.sustain, when + durationSeconds);
      gain.gain.linearRampToValueAtTime(0, when + durationSeconds + timbre.release);

      const source = ctx.createBufferSource();
      source.buffer = sampleOf(request.role);
      source.loop = looped;
      // 1 周期を敷き詰めて音程を作る。基準音は sampleRate / 周期長
      source.playbackRate.value = looped
        ? request.frequency / (sampleRate / CYCLE_SAMPLES)
        : Math.max(request.frequency / 220, 0.25);
      source.connect(gain);
      source.start(when);
      source.stop(when + durationSeconds + timbre.release + 0.02);

      return {
        stop(at: number): void {
          try {
            gain.gain.cancelScheduledValues(at);
            gain.gain.setTargetAtTime(0, at, 0.008);
            source.stop(at + 0.03);
          } catch {
            // すでに停止済みなら何もしない
          }
        },
      };
    },
    dispose(): void {
      output.disconnect();
      echoSend?.disconnect();
    },
  };
}
