/** FDS-inspired single voice. See Docs/FDS_AUDIO.md for accuracy boundaries. */
import type { GenerationVoiceSource, VoiceHandle } from './engine';
export const FDS_CLOCK = 1789773;
export const FDS_WAVE = Array.from({ length: 64 }, (_, i) => Math.round(31.5 + 22 * Math.sin(i * Math.PI / 32) + 8 * Math.sin(i * Math.PI / 16)));
export const FDS_MOD = [1,1,1,1,0,0,7,7,7,7,7,7,0,0,1,1,1,1,1,1,0,0,7,7,7,7,7,7,0,0,1,1];
export function fdsModCounter(counter: number, code: number): number {
  if (code === 4) return 0;
  return ((counter + [0,1,2,4,0,-4,-2,-1][code]! + 64) & 127) - 64;
}
export function fdsPitch(hz: number): number { return Math.max(0, Math.min(4095, Math.round(hz * 4194304 / FDS_CLOCK))); }
/** Quantized wave/pitch, doubled 3-bit steps; modulation depth and envelope are musical approximations. */
export function renderFds(hz: number, duration: number, rate: number, velocity = 1): Float32Array {
  const out = new Float32Array(Math.ceil(duration * rate));
  let phase = 0;
  let bias = 0;
  let previous = -1;
  const pitch = fdsPitch(hz);
  let filtered = 0;
  const smoothing = 1 - Math.exp(-2 * Math.PI * 2000 / rate);
  const mean = FDS_WAVE.reduce((a, b) => a + b, 0) / 64;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const step = Math.floor(t * 64 * 5) % 64;
    if (step !== previous) {
      const code = FDS_MOD[Math.floor(step / 2)]!;
      bias = fdsModCounter(bias, code);
      previous = step;
    }
    const envelope = Math.min(1, t / 0.008, (duration - t) / 0.015);
    const sample = (FDS_WAVE[Math.floor(phase * 64) & 63]! - mean) / 32 * 0.075 * Math.min(32, Math.max(0, Math.round(velocity * 32))) / 32 * Math.round(envelope * 32) / 32;
    filtered += smoothing * (sample - filtered);
    out[i] = filtered;
    phase = (phase + FDS_CLOCK * pitch / 4194304 * (1 + bias / 1024) / rate) % 1;
  }
  return out;
}
export function createFdsSource(ctx: BaseAudioContext, destination: AudioNode): GenerationVoiceSource {
  const active = new Set<AudioBufferSourceNode>();
  let last: VoiceHandle | null = null;
  return {
    voiceLimit: 1,
    play(request) {
      last?.stop(request.when);
      const data = renderFds(request.frequency, request.durationSeconds, ctx.sampleRate, request.velocity);
      const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buffer.getChannelData(0).set(data);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      active.add(source);
      source.onended = () => { source.disconnect(); active.delete(source); };
      source.start(request.when);
      source.stop(request.when + request.durationSeconds);
      last = { stop(when) { try { source.stop(when); } catch { /* ended */ } } };
      return last;
    },
    dispose() { for (const source of active) { try { source.stop(); } catch { /* ended */ } source.disconnect(); } active.clear(); last = null; },
  };
}
