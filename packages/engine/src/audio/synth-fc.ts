/**
 * 第1世代（FC）の音源合成（T0-17、GAME_PLAN §9）。
 *
 * 実機の音源は 5 声：矩形波 2（デューティ比可変）、三角波、ノイズ、PCM。
 * ここでは Web Audio でその構成を再現する。
 *
 * 実機らしさの要点：
 * - 矩形波のデューティ比（12.5% / 25% / 50%）で音色が変わる
 * - 三角波は音量を持たない（ベースが常に同じ大きさで鳴る）
 * - ノイズは短周期・長周期の 2 種類
 * - エンベロープは粗い（減衰のみ）
 */

import type { GenerationVoiceSource, PlayRequest, VoiceHandle, VoiceSourceOptions } from './engine';
import type { TrackRole } from './score';

export type FcChannel = 'pulse1' | 'pulse2' | 'triangle' | 'noise' | 'pcm';

/** 実機の同時発音数（§5.8 の 5 / 8 / 24 / 48 のうち第1世代） */
export const FC_VOICE_LIMIT = 5;

export type PulseDuty = 0.125 | 0.25 | 0.5;

export interface FcVoiceHandle {
  channel: FcChannel;
  stop(when: number): void;
}

export interface FcSynth {
  readonly output: AudioNode;
  /**
   * 発音する。`when` は AudioContext の時間軸。
   * @returns 停止用のハンドル
   */
  play(options: {
    channel: FcChannel;
    frequency: number;
    when: number;
    durationSeconds: number;
    velocity?: number;
    duty?: PulseDuty;
  }): FcVoiceHandle;
  dispose(): void;
}

/**
 * デューティ比つき矩形波を PeriodicWave で作る。
 * OscillatorType の 'square' は 50% 固定なので、実機の音色差を出せない。
 *
 * Safari では PeriodicWave の生成に失敗する報告があるため、
 * 失敗時は 'square' へ落とす（§5.8 の Safari 差異への備え）。
 */
function createPulseWave(ctx: BaseAudioContext, duty: number, harmonics = 32): PeriodicWave | null {
  try {
    const real = new Float32Array(harmonics);
    const imag = new Float32Array(harmonics);
    for (let n = 1; n < harmonics; n++) {
      // 矩形波のフーリエ係数（デューティ比 d のパルス列）
      imag[n] = (2 / (n * Math.PI)) * Math.sin(Math.PI * n * duty);
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  } catch {
    return null;
  }
}

/** ノイズ用のバッファ。長周期（ホワイトに近い）と短周期（金属的）の 2 種 */
function createNoiseBuffer(ctx: BaseAudioContext, short: boolean): AudioBuffer {
  const length = short ? 93 : 32767; // 実機のシフトレジスタ周期に倣った長さ
  const buffer = ctx.createBuffer(1, Math.max(length, 128), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // 線形帰還シフトレジスタ（決定的。再生ごとに音が変わらない）
  let register = 1;
  for (let i = 0; i < data.length; i++) {
    const bit = (register & 1) ^ ((register >> (short ? 6 : 1)) & 1);
    register = (register >> 1) | (bit << 14);
    data[i] = (register & 1) === 0 ? 0.6 : -0.6;
  }
  return buffer;
}

export function createFcSynth(ctx: BaseAudioContext, destination: AudioNode): FcSynth {
  const output = ctx.createGain();
  output.gain.value = 0.25;
  output.connect(destination);

  const pulseWaves = new Map<number, PeriodicWave | null>();
  const noiseLong = createNoiseBuffer(ctx, false);
  const noiseShort = createNoiseBuffer(ctx, true);

  function pulseWave(duty: number): PeriodicWave | null {
    if (!pulseWaves.has(duty)) pulseWaves.set(duty, createPulseWave(ctx, duty));
    return pulseWaves.get(duty) ?? null;
  }

  return {
    output,
    play({ channel, frequency, when, durationSeconds, velocity = 1, duty = 0.5 }): FcVoiceHandle {
      const gain = ctx.createGain();
      gain.connect(output);

      // 三角波は音量を持たない（実機の仕様）。他は velocity に従う
      const level = channel === 'triangle' ? 0.5 : 0.4 * velocity;
      gain.gain.setValueAtTime(level, when);
      // 粗い減衰エンベロープ
      gain.gain.setTargetAtTime(0, when + durationSeconds * 0.6, durationSeconds * 0.25);
      gain.gain.setValueAtTime(0, when + durationSeconds);

      let source: AudioScheduledSourceNode;
      if (channel === 'noise' || channel === 'pcm') {
        const noise = ctx.createBufferSource();
        noise.buffer = channel === 'noise' ? noiseLong : noiseShort;
        noise.loop = true;
        // 音程はサンプリングレートの比で表す（実機のノイズ周期に相当）
        noise.playbackRate.value = Math.max(frequency / 440, 0.05);
        source = noise;
      } else {
        const oscillator = ctx.createOscillator();
        const wave = channel === 'triangle' ? null : pulseWave(duty);
        if (channel === 'triangle') oscillator.type = 'triangle';
        else if (wave) oscillator.setPeriodicWave(wave);
        else oscillator.type = 'square'; // Safari での退避経路
        oscillator.frequency.setValueAtTime(frequency, when);
        source = oscillator;
      }

      source.connect(gain);
      source.start(when);
      source.stop(when + durationSeconds + 0.05);

      return {
        channel,
        stop(at: number): void {
          try {
            gain.gain.cancelScheduledValues(at);
            gain.gain.setTargetAtTime(0, at, 0.005);
            source.stop(at + 0.02);
          } catch {
            // すでに停止済みの場合は何もしない
          }
        },
      };
    },
    dispose(): void {
      output.disconnect();
    },
  };
}

/**
 * 役割 → 実機の 5 チャンネルの割り当て（T1-16）。
 *
 * 5 声しかないので、割り当ては固定にする。役割が増えたときに
 * 「どの音が消えるか」がここを読めば分かる状態を保つ。
 */
const FC_CHANNEL_OF: Record<TrackRole, { channel: FcChannel; duty: PulseDuty }> = {
  lead: { channel: 'pulse1', duty: 0.5 },
  pad: { channel: 'pulse2', duty: 0.25 },
  bass: { channel: 'triangle', duty: 0.5 },
  perc: { channel: 'noise', duty: 0.5 },
  fx: { channel: 'pcm', duty: 0.125 },
};

/** engine が扱う形（`GenerationVoiceSource`）に包む。第1世代の音源（T1-16） */
export function createFcSource(
  ctx: BaseAudioContext,
  destination: AudioNode,
  options: VoiceSourceOptions,
): GenerationVoiceSource {
  const synth = createFcSynth(ctx, destination);
  return {
    voiceLimit: options.voiceLimit,
    play(request: PlayRequest): VoiceHandle {
      const { channel, duty } = FC_CHANNEL_OF[request.role];
      return synth.play({
        channel,
        frequency: request.frequency,
        when: request.when,
        durationSeconds: request.durationSeconds,
        velocity: request.velocity,
        duty,
      });
    },
    dispose: () => synth.dispose(),
  };
}
