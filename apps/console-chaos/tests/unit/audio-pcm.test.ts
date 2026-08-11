import { describe, expect, it } from 'vitest';
import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  createGenerationAudioService,
  scoreLengthTicks,
  secondsPerTick,
  type GenerationId,
} from '@console-chaos/engine';
import { arrangeFor } from '@/audio/music';
import { songOf } from '@/audio/songs';
import golden from '../../Docs/measurements/M4_pcm_golden.json';
// This pure-JS Web Audio implementation intentionally has no bundled TypeScript declarations.
// @ts-expect-error -- runtime API is narrowed by RenderingContext below.
import { RenderingAudioContext } from 'web-audio-engine';

interface AudioData {
  channelData: Float32Array[];
  sampleRate: number;
}

interface RenderingContext extends BaseAudioContext {
  processTo(time: number): void;
  exportAsAudioData(): AudioData;
}

interface PcmMeasurement {
  generation: GenerationId;
  peak: number;
  rms: number;
  silentWindows: number;
  fingerprint: string;
}

const CAPTURE_SECONDS = 14.4;

function measurePcm(generation: GenerationId, channels: readonly Float32Array[], sampleRate: number): PcmMeasurement {
  let peak = 0;
  let squareSum = 0;
  let sampleCount = 0;
  let hash = 0x811c9dc5;
  const windowSize = Math.round(sampleRate * 0.25);
  let silentWindows = 0;
  const length = channels[0]?.length ?? 0;

  for (let offset = 0; offset < length; offset += windowSize) {
    let windowSquares = 0;
    let windowSamples = 0;
    const end = Math.min(offset + windowSize, length);
    for (const channel of channels) {
      for (let index = offset; index < end; index++) {
        const sample = channel[index] ?? 0;
        peak = Math.max(peak, Math.abs(sample));
        squareSum += sample * sample;
        windowSquares += sample * sample;
        sampleCount++;
        windowSamples++;
        const quantized = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
        hash ^= quantized & 0xffff;
        hash = Math.imul(hash, 0x01000193);
      }
    }
    if (Math.sqrt(windowSquares / Math.max(windowSamples, 1)) < 1e-4) silentWindows++;
  }

  return {
    generation,
    peak,
    rms: Math.sqrt(squareSum / Math.max(sampleCount, 1)),
    silentWindows,
    fingerprint: (hash >>> 0).toString(16).padStart(8, '0'),
  };
}

function renderGeneration(generation: GenerationId): PcmMeasurement {
  const sampleRate = 48_000;
  const context = new RenderingAudioContext({
    sampleRate,
    numberOfChannels: 2,
    blockSize: 128,
  }) as RenderingContext;
  const createLegacyPanner = context.createPanner.bind(context);
  context.createPanner = () => Object.assign(createLegacyPanner(), {
    positionX: { value: 0 },
    positionY: { value: 0 },
    positionZ: { value: 0 },
  }) as unknown as PannerNode;
  const profile = HARDWARE_GENERATION_PROFILES[generation];
  const score = arrangeFor(profile, songOf('pop').score);
  const service = createGenerationAudioService(context as unknown as AudioContext, score);
  service.setGenerationProfile(profile);
  service.playScore(score);
  const loopSeconds = scoreLengthTicks(score) * secondsPerTick(score);
  if (loopSeconds >= CAPTURE_SECONDS) throw new Error('PCM capture must include a full score loop');
  while (context.currentTime < CAPTURE_SECONDS) {
    service.update();
    context.processTo(Math.min(CAPTURE_SECONDS, context.currentTime + 0.05));
  }
  const rendered = context.exportAsAudioData();
  return measurePcm(generation, rendered.channelData, rendered.sampleRate);
}

describe('Console offline PCM parity', () => {
  it('renders all generations without silent 0.25s windows or clipping', () => {
    const measurements = GENERATION_IDS.map(renderGeneration);
    expect(measurements.every(({ silentWindows }) => silentWindows === 0)).toBe(true);
    expect(measurements.every(({ peak }) => peak > 0.1 && peak < 1)).toBe(true);
    expect(new Set(measurements.map(({ fingerprint }) => fingerprint)).size).toBe(GENERATION_IDS.length);
    expect(measurements.map((measurement) => ({
      ...measurement,
      peak: Number(measurement.peak.toFixed(6)),
      rms: Number(measurement.rms.toFixed(6)),
    }))).toEqual(golden.measurements);
  }, 60_000);
});
