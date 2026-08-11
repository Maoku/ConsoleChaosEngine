import type { HardwareGenerationProfile } from '../generation/profiles';
import { createPs1Source } from './adpcm-ps1';
import { createAudioEngine, type AudioEngine, type GenerationVoiceSource, type PlayRequest, type VoiceSourceOptions } from './engine';
import { createSfcSampler } from './sampler-sfc';
import type { Score } from './score';
import { createPs2Source } from './stream-ps2';
import { createFcSource } from './synth-fc';

export interface TransportClock {
  readonly bpm: number;
  readonly beatsPerBar: number;
  start(audioTime: number): void;
  stop(audioTime: number): void;
  resume(audioTime: number): void;
  beatAt(audioTime: number): number;
  barAt(audioTime: number): number;
}

export function createTransportClock(bpm: number, beatsPerBar = 4): TransportClock {
  let origin = 0;
  let pausedBeat = 0;
  let playing = false;
  const beatAt = (audioTime: number): number => playing ? pausedBeat + (audioTime - origin) * bpm / 60 : pausedBeat;
  return {
    bpm,
    beatsPerBar,
    start(audioTime): void {
      origin = audioTime;
      pausedBeat = 0;
      playing = true;
    },
    stop(audioTime): void {
      pausedBeat = beatAt(audioTime);
      playing = false;
    },
    resume(audioTime): void {
      origin = audioTime;
      playing = true;
    },
    beatAt,
    barAt: (audioTime) => beatAt(audioTime) / beatsPerBar,
  };
}

export interface AudioService {
  readonly currentTime: number;
  readonly clock: TransportClock;
  readonly currentSourceKey: string | null;
  readonly barPosition: number;
  unlock(): Promise<void>;
  setGenerationVoiceLimit(limit: number): void;
  setGenerationProfile(profile: HardwareGenerationProfile): void;
  playScore(score: Score, fromTick?: number): void;
  useScore(score: Score): void;
  playOneShot(request: PlayRequest): void;
  playTone(frequency: number, durationSeconds: number, gain?: number): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  update(): void;
  dispose(): void;
}

export function createNullAudioService(bpm = 120): AudioService {
  const clock = createTransportClock(bpm);
  clock.start(0);
  return {
    currentTime: 0,
    clock,
    currentSourceKey: null,
    get barPosition() {
      return clock.barAt(0);
    },
    unlock: async () => {},
    setGenerationVoiceLimit: () => {},
    setGenerationProfile: () => {},
    playScore: () => {},
    useScore: () => {},
    playOneShot: () => {},
    playTone: () => {},
    setMuted: () => {},
    setVolume: () => {},
    update: () => {},
    dispose: () => {},
  };
}

export function createWebAudioService(context: AudioContext, bpm = 120): AudioService {
  const clock = createTransportClock(bpm);
  const voices: Array<{ oscillator: OscillatorNode; startedAt: number }> = [];
  let voiceLimit = 8;
  let muted = false;
  let volume = 1;
  clock.start(context.currentTime);

  const prune = (): void => {
    const now = context.currentTime;
    for (let index = voices.length - 1; index >= 0; index--) {
      if ((voices[index]?.startedAt ?? now) < now - 5) voices.splice(index, 1);
    }
  };

  const playTone = (frequency: number, durationSeconds: number, gain = 0.04): void => {
    if (muted) return;
    prune();
    while (voices.length >= voiceLimit) {
      const voice = voices.shift();
      try { voice?.oscillator.stop(); } catch { /* already stopped */ }
    }
    const oscillator = context.createOscillator();
    const amplitude = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = frequency;
    amplitude.gain.setValueAtTime(gain * volume, context.currentTime);
    amplitude.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + durationSeconds);
    oscillator.connect(amplitude).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + durationSeconds);
    voices.push({ oscillator, startedAt: context.currentTime });
  };

  return {
    get currentTime() {
      return context.currentTime;
    },
    clock,
    currentSourceKey: null,
    get barPosition() {
      return clock.barAt(context.currentTime);
    },
    unlock: async () => context.resume(),
    setGenerationVoiceLimit(limit): void {
      voiceLimit = Math.max(1, limit);
    },
    setGenerationProfile(profile): void {
      voiceLimit = Math.max(1, profile.audio.channels);
    },
    playScore: () => {},
    useScore: () => {},
    playOneShot: (request) => playTone(request.frequency, request.durationSeconds, request.velocity * 0.04),
    playTone,
    setMuted(value): void {
      muted = value;
    },
    setVolume(value): void {
      volume = Math.min(Math.max(value, 0), 1);
    },
    update: prune,
    dispose(): void {
      for (const voice of voices) {
        try { voice.oscillator.stop(); } catch { /* already stopped */ }
      }
      voices.length = 0;
      void context.close();
    },
  };
}

type SourceFactory = (
  context: BaseAudioContext,
  destination: AudioNode,
  options: VoiceSourceOptions,
) => GenerationVoiceSource;

const GENERATION_SOURCE_FACTORIES: Record<HardwareGenerationProfile['audio']['synth'], SourceFactory> = {
  psg: createFcSource,
  brr: createSfcSampler,
  adpcm: createPs1Source,
  streaming: createPs2Source,
};

export interface GenerationAudioService extends AudioService {
  readonly engine: AudioEngine;
}

export function createGenerationAudioService(
  context: AudioContext,
  initialScore: Score,
  destination: AudioNode = context.destination,
): GenerationAudioService {
  const master = context.createGain();
  master.gain.value = 0.8;
  master.connect(destination);
  const engine = createAudioEngine(context, initialScore);
  const registered = new Set<string>();
  const clock = createTransportClock(initialScore.bpm, initialScore.beatsPerBar);
  clock.start(context.currentTime);
  let muted = false;
  let pausedAtTick = 0;

  const setGenerationProfile = (profile: HardwareGenerationProfile): void => {
    const key = profile.audio.synth;
    if (!registered.has(key)) {
      engine.registerSource(key, GENERATION_SOURCE_FACTORIES[key](context, master, {
        voiceLimit: profile.audio.channels,
        sampleRate: profile.audio.sampleRate,
        reverb: profile.audio.reverb,
        positional: profile.audio.positional,
      }));
      registered.add(key);
    }
    if (engine.currentSourceKey !== key) engine.useSource(key);
  };

  return {
    engine,
    get currentTime() {
      return context.currentTime;
    },
    clock,
    get currentSourceKey() {
      return engine.currentSourceKey;
    },
    get barPosition() {
      return engine.clock.barAt(context.currentTime);
    },
    unlock: async () => context.resume(),
    setGenerationVoiceLimit: () => {},
    setGenerationProfile,
    playScore(score, fromTick = 0): void {
      pausedAtTick = fromTick;
      engine.useArrangement(score);
      if (!muted) engine.startMusic(score, fromTick);
    },
    useScore: (score) => engine.useArrangement(score),
    playOneShot: (request) => engine.playOneShot(request),
    playTone(frequency, durationSeconds, gain = 0.04): void {
      engine.playOneShot({
        role: 'fx',
        frequency,
        when: context.currentTime + 0.01,
        durationSeconds,
        velocity: gain / 0.04,
      });
    },
    setMuted(value): void {
      if (value === muted) return;
      if (value) pausedAtTick = engine.clock.tickAt(context.currentTime);
      muted = value;
      if (muted) engine.stopMusic();
      else engine.startMusic(engine.clock.score, pausedAtTick);
    },
    setVolume(value): void {
      master.gain.value = Math.min(Math.max(value, 0), 1);
    },
    update: () => engine.update(),
    dispose(): void {
      engine.dispose();
      master.disconnect();
      registered.clear();
      void context.close();
    },
  };
}
