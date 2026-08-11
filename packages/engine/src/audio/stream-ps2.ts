/**
 * 第4世代（PS2）の音源（T1-16、GAME_PLAN §9.1）。
 *
 * 実機は 48kHz・48 声で、3D 定位と多層の環境音が特徴。
 * 本作での世代差の見せ場は「**音が多すぎて、意味のある音が埋もれる**」（§9.3）ことなので、
 *
 * - `PannerNode` による定位（`positional` が真のときだけ作る）
 * - 声ごとの微小なデチューン 2 層（厚みが出る代わりに輪郭が甘くなる）
 * - 長い残響
 *
 * を持たせている。第1世代の「5 声しかないから 1 音 1 音が意味を持つ」との対比が要点。
 *
 * 第3世代と同じく、BGM はストリーミング再生ではなく合成（理由は `adpcm_ps1.ts` の冒頭）。
 */
import type { GenerationVoiceSource, PlayRequest, VoiceHandle, VoiceSourceOptions } from './engine';
import type { TrackRole } from './score';

const CYCLE_SAMPLES = 256;

interface Timbre {
  harmonics: readonly number[];
  attack: number;
  release: number;
  send: number;
  /** 重ねる層の数。多いほど厚く、輪郭が甘くなる */
  layers: number;
}

const TIMBRES: Record<TrackRole, Timbre> = {
  lead: { harmonics: [1, 0.4, 0.28, 0.16, 0.1, 0.06, 0.04], attack: 0.014, release: 0.22, send: 0.3, layers: 2 },
  bass: { harmonics: [1, 0.4, 0.2, 0.1, 0.05], attack: 0.008, release: 0.16, send: 0.15, layers: 2 },
  pad: { harmonics: [1, 0.75, 0.55, 0.4, 0.3, 0.22, 0.16, 0.1], attack: 0.2, release: 0.7, send: 0.55, layers: 2 },
  perc: { harmonics: [], attack: 0.001, release: 0.12, send: 0.2, layers: 1 },
  fx: { harmonics: [1, 0.3, 0.5, 0.25, 0.15, 0.1], attack: 0.003, release: 0.14, send: 0.25, layers: 2 },
};

/** 層ごとのデチューン量（セント）。1 層目は必ず 0（原音を濁らせない） */
const DETUNE_CENTS = [0, 7];

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
  // 量子化しない（16bit 相当。ここが第1〜3世代との一番の差）
  for (let i = 0; i < CYCLE_SAMPLES; i++) data[i] = (data[i] ?? 0) / (peak || 1);
  return buffer;
}

function noiseBuffer(ctx: BaseAudioContext, sampleRate: number): AudioBuffer {
  const length = Math.max(Math.floor(sampleRate * 0.35), 128);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x6b8b4567;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x3fffffff - 1) * Math.pow(1 - i / length, 1.6);
  }
  return buffer;
}

function reverbImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.max(Math.floor(ctx.sampleRate * seconds), 128);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = 0x41c64e6d;
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x3fffffff - 1) * Math.pow(1 - i / length, 1.8);
    }
  }
  return buffer;
}

export function createPs2Source(
  ctx: BaseAudioContext,
  destination: AudioNode,
  options: VoiceSourceOptions,
): GenerationVoiceSource {
  const sampleRate = options.sampleRate > 0 ? options.sampleRate : ctx.sampleRate;
  const output = ctx.createGain();
  output.gain.value = 0.18;
  output.connect(destination);

  let reverbSend: GainNode | null = null;
  if (options.reverb) {
    const convolver = ctx.createConvolver();
    convolver.buffer = reverbImpulse(ctx, 2.2);
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
      // 定位を持つ世代だけ Panner を挟む。持たない世代では作らない（無駄なノードを増やさない）
      let tail: AudioNode = gain;
      if (options.positional) {
        const panner = ctx.createPanner();
        panner.panningModel = 'equalpower';
        panner.positionX.value = request.pan ?? 0;
        panner.positionY.value = 0;
        panner.positionZ.value = 1 - Math.abs(request.pan ?? 0) * 0.5;
        gain.connect(panner);
        tail = panner;
      }
      tail.connect(output);
      if (reverbSend) {
        const send = ctx.createGain();
        send.gain.value = timbre.send;
        tail.connect(send);
        send.connect(reverbSend);
      }

      const peak = (0.42 * velocity) / timbre.layers;
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(peak, when + timbre.attack);
      gain.gain.setValueAtTime(peak, when + durationSeconds);
      gain.gain.linearRampToValueAtTime(0, when + durationSeconds + timbre.release);

      const sources: AudioScheduledSourceNode[] = [];
      for (let layer = 0; layer < timbre.layers; layer++) {
        const source = ctx.createBufferSource();
        source.buffer = sampleOf(request.role);
        source.loop = looped;
        const detune = Math.pow(2, (DETUNE_CENTS[layer] ?? 0) / 1200);
        source.playbackRate.value = looped
          ? (request.frequency * detune) / (sampleRate / CYCLE_SAMPLES)
          : Math.max(request.frequency / 220, 0.25) * detune;
        source.connect(gain);
        source.start(when);
        source.stop(when + durationSeconds + timbre.release + 0.02);
        sources.push(source);
      }

      return {
        stop(at: number): void {
          try {
            gain.gain.cancelScheduledValues(at);
            gain.gain.setTargetAtTime(0, at, 0.012);
            for (const source of sources) source.stop(at + 0.05);
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
