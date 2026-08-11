import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  createFcSource,
  createPs1Source,
  createPs2Source,
  createSfcSampler,
  pitchToFrequency,
  secondsPerTick,
  type GenerationVoiceSource,
  type HardwareGenerationProfile,
  type VoiceSourceOptions,
} from '@console-chaos/engine';
import { arrangeRacingScore } from '../content/audio/arrangements';
import { RACING_BAR_TICKS, RACING_MASTER_SCORE } from '../content/audio/score';

interface AudioProofResult {
  generation: string;
  peak: number;
  silentWindows: number;
  clippedSamples: number;
  frames: number;
}

type SourceFactory = (
  context: BaseAudioContext,
  destination: AudioNode,
  options: VoiceSourceOptions,
) => GenerationVoiceSource;

const FACTORIES: Record<HardwareGenerationProfile['audio']['synth'], SourceFactory> = {
  psg: createFcSource,
  brr: createSfcSampler,
  adpcm: createPs1Source,
  streaming: createPs2Source,
};

async function renderProof(profile: HardwareGenerationProfile): Promise<AudioProofResult> {
  const sampleRate = 48_000;
  const score = arrangeRacingScore(profile, RACING_MASTER_SCORE);
  const secondsPerScoreTick = secondsPerTick(score);
  const durationSeconds = RACING_BAR_TICKS * 2 * secondsPerScoreTick;
  const frames = Math.ceil((durationSeconds + 0.3) * sampleRate);
  const context = new OfflineAudioContext(2, frames, sampleRate);
  const source = FACTORIES[profile.audio.synth](context, context.destination, {
    voiceLimit: profile.audio.channels,
    sampleRate: profile.audio.sampleRate,
    reverb: profile.audio.reverb,
    positional: profile.audio.positional,
  });
  for (const track of score.tracks) {
    for (const note of track.notes) {
      if (note.tick >= RACING_BAR_TICKS * 2) continue;
      source.play({
        role: track.role,
        frequency: pitchToFrequency(note.pitch),
        when: note.tick * secondsPerScoreTick,
        durationSeconds: note.durationTicks * secondsPerScoreTick,
        velocity: note.velocity,
      });
    }
  }
  const rendered = await context.startRendering();
  source.dispose();
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, channel) => rendered.getChannelData(channel));
  let peak = 0;
  let clippedSamples = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      const magnitude = Math.abs(sample);
      peak = Math.max(peak, magnitude);
      if (magnitude >= 0.9999) clippedSamples++;
    }
  }
  const windowFrames = Math.round(sampleRate * 0.05);
  const musicFrames = Math.floor(durationSeconds * sampleRate);
  let silentWindows = 0;
  for (let start = 0; start < musicFrames; start += windowFrames) {
    let energy = 0;
    let count = 0;
    for (const channel of channels) {
      for (let frame = start; frame < Math.min(start + windowFrames, musicFrames); frame++) {
        const sample = channel[frame] ?? 0;
        energy += sample * sample;
        count++;
      }
    }
    if (Math.sqrt(energy / Math.max(count, 1)) < 0.0001) silentWindows++;
  }
  return { generation: profile.id, peak, silentWindows, clippedSamples, frames };
}

const results = await Promise.all(GENERATION_IDS.map((id) => renderProof(HARDWARE_GENERATION_PROFILES[id])));
const passed = results.every((result) => result.peak > 0 && result.peak < 0.9999 && result.silentWindows === 0 && result.clippedSamples === 0);
const body = document.querySelector<HTMLTableSectionElement>('#results');
const status = document.querySelector<HTMLElement>('#status');
if (!body || !status) throw new Error('Audio proof DOM is incomplete');
for (const result of results) {
  const row = document.createElement('tr');
  for (const value of [result.generation, result.peak.toFixed(6), result.silentWindows, result.clippedSamples, result.frames]) {
    const cell = document.createElement('td');
    cell.textContent = String(value);
    row.append(cell);
  }
  body.append(row);
}
status.textContent = passed ? 'PASS' : 'FAIL';
status.dataset.status = passed ? 'pass' : 'fail';
document.documentElement.dataset.audioProof = passed ? 'pass' : 'fail';
(globalThis as Record<string, unknown>)['__racingAudioProof'] = results;
