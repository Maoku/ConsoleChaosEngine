/**
 * 第3世代（PS1）の ADPCM 音源（T1-16、GAME_PLAN §9.1）。
 *
 * 実機は 24 声の ADPCM 再生機で、44.1kHz のサンプルとハードウェアリバーブを持つ。
 * 第2世代との差は「声数の余裕」と「残響の深さ」であって、音の作り方そのものではない。
 *
 * ここでは 4bit ADPCM の**予測子つき量子化**をサンプルに焼き込む。
 * 波形の階段状の歪みが第2世代の疑似 BRR とは別の質感になる（前値からの差分を丸めるため、
 * 急峻な立ち上がりが鈍り、緩やかな部分は滑らかに残る）。
 *
 * **BGM の実体はストリーミング（1 本のファイル）ではなく合成である。**
 * GAME_PLAN §9.1 は第3世代を「BGM はストリーミング」としているが、
 * 楽曲ファイルを持つと (a) 4 編曲分の音声アセットが要る (b) 位相同期を
 * ファイル再生位置で合わせる別実装が要る、の 2 点でフェーズ 1 の範囲を超える。
 * **同一 Score を 4 通りに鳴らす**（§9.1 の主眼）ほうを優先した。
 * 差分は Docs/measurements/T1-16_music.md に記録している。
 */
import type { GenerationVoiceSource, PlayRequest, VoiceHandle, VoiceSourceOptions } from './engine';
import type { TrackRole } from './score';

const CYCLE_SAMPLES = 128;
/** ADPCM の量子化段数（4bit = 16 段。差分に対してかける） */
export const ADPCM_LEVELS = 16;

interface Timbre {
  harmonics: readonly number[];
  attack: number;
  release: number;
  /** リバーブ送りの量 0..1。役割ごとに残響の乗り方を変える */
  send: number;
}

const TIMBRES: Record<TrackRole, Timbre> = {
  lead: { harmonics: [1, 0.45, 0.3, 0.18, 0.1, 0.06], attack: 0.012, release: 0.18, send: 0.35 },
  bass: { harmonics: [1, 0.35, 0.15, 0.05], attack: 0.006, release: 0.12, send: 0.15 },
  pad: { harmonics: [1, 0.7, 0.5, 0.35, 0.25, 0.18, 0.12], attack: 0.12, release: 0.5, send: 0.5 },
  perc: { harmonics: [], attack: 0.001, release: 0.08, send: 0.25 },
  fx: { harmonics: [1, 0.2, 0.5, 0.3, 0.1], attack: 0.002, release: 0.1, send: 0.3 },
};

/**
 * 4bit ADPCM 相当の量子化。**差分を丸める**ので、前の値に依存して誤差が乗る。
 * これが第2世代の「各サンプルを独立に丸める」との音質差になる。
 */
export function adpcmEncodeDecode(samples: Float32Array): Float32Array {
  const out = new Float32Array(samples.length);
  const step = 2 / (ADPCM_LEVELS - 1);
  let predictor = 0;
  for (let i = 0; i < samples.length; i++) {
    const delta = (samples[i] ?? 0) - predictor;
    const code = Math.max(-8, Math.min(7, Math.round(delta / step)));
    predictor = Math.max(-1, Math.min(1, predictor + code * step));
    out[i] = predictor;
  }
  return out;
}

function cycleBuffer(ctx: BaseAudioContext, sampleRate: number, harmonics: readonly number[]): AudioBuffer {
  const raw = new Float32Array(CYCLE_SAMPLES);
  let peak = 0;
  for (let i = 0; i < CYCLE_SAMPLES; i++) {
    const phase = (i / CYCLE_SAMPLES) * Math.PI * 2;
    let value = 0;
    harmonics.forEach((amplitude, index) => {
      value += amplitude * Math.sin(phase * (index + 1));
    });
    raw[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  for (let i = 0; i < CYCLE_SAMPLES; i++) raw[i] = (raw[i] ?? 0) / (peak || 1);

  const encoded = adpcmEncodeDecode(raw);
  const buffer = ctx.createBuffer(1, CYCLE_SAMPLES, sampleRate);
  buffer.getChannelData(0).set(encoded);
  return buffer;
}

function noiseBuffer(ctx: BaseAudioContext, sampleRate: number): AudioBuffer {
  const length = Math.max(Math.floor(sampleRate * 0.3), 128);
  const raw = new Float32Array(length);
  let seed = 0x1f123bb5;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = (seed / 0x3fffffff - 1) * Math.pow(1 - i / length, 2);
  }
  const buffer = ctx.createBuffer(1, length, sampleRate);
  buffer.getChannelData(0).set(adpcmEncodeDecode(raw));
  return buffer;
}

/** ホールらしい残響。第2世代のエコーより長く、拡散する */
function reverbImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.max(Math.floor(ctx.sampleRate * seconds), 128);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = 0x27d4eb2f;
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      // 立ち上がりを少し遅らせる（初期反射のあとに残響が来る）
      const envelope = Math.pow(1 - i / length, 2.2) * Math.min(1, i / (ctx.sampleRate * 0.02));
      data[i] = (seed / 0x3fffffff - 1) * envelope;
    }
  }
  return buffer;
}

export function createPs1Source(
  ctx: BaseAudioContext,
  destination: AudioNode,
  options: VoiceSourceOptions,
): GenerationVoiceSource {
  const sampleRate = options.sampleRate > 0 ? options.sampleRate : ctx.sampleRate;
  const output = ctx.createGain();
  output.gain.value = 0.2;
  output.connect(destination);

  let reverbSend: GainNode | null = null;
  if (options.reverb) {
    const convolver = ctx.createConvolver();
    convolver.buffer = reverbImpulse(ctx, 1.4);
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 1;
    reverbSend.connect(convolver);
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
      const { when, durationSeconds, velocity } = request;

      const gain = ctx.createGain();
      gain.connect(output);
      if (reverbSend) {
        const send = ctx.createGain();
        send.gain.value = timbre.send;
        gain.connect(send);
        send.connect(reverbSend);
      }

      const peak = 0.45 * velocity;
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(peak, when + timbre.attack);
      gain.gain.setValueAtTime(peak, when + durationSeconds);
      gain.gain.linearRampToValueAtTime(0, when + durationSeconds + timbre.release);

      const source = ctx.createBufferSource();
      source.buffer = sampleOf(request.role);
      source.loop = looped;
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
            gain.gain.setTargetAtTime(0, at, 0.01);
            source.stop(at + 0.04);
          } catch {
            // すでに停止済みなら何もしない
          }
        },
      };
    },
    dispose(): void {
      output.disconnect();
      reverbSend?.disconnect();
    },
  };
}
