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
  unlock(): Promise<void>;
  setGenerationVoiceLimit(limit: number): void;
  playTone(frequency: number, durationSeconds: number, gain?: number): void;
  update(): void;
  dispose(): void;
}

export function createNullAudioService(bpm = 120): AudioService {
  const clock = createTransportClock(bpm);
  clock.start(0);
  return {
    currentTime: 0,
    clock,
    unlock: async () => {},
    setGenerationVoiceLimit: () => {},
    playTone: () => {},
    update: () => {},
    dispose: () => {},
  };
}

export function createWebAudioService(context: AudioContext, bpm = 120): AudioService {
  const clock = createTransportClock(bpm);
  const voices: Array<{ oscillator: OscillatorNode; startedAt: number }> = [];
  let voiceLimit = 8;
  clock.start(context.currentTime);

  const prune = (): void => {
    const now = context.currentTime;
    for (let index = voices.length - 1; index >= 0; index--) {
      if ((voices[index]?.startedAt ?? now) < now - 5) voices.splice(index, 1);
    }
  };

  return {
    get currentTime() {
      return context.currentTime;
    },
    clock,
    unlock: async () => context.resume(),
    setGenerationVoiceLimit(limit): void {
      voiceLimit = Math.max(1, limit);
    },
    playTone(frequency, durationSeconds, gain = 0.04): void {
      prune();
      while (voices.length >= voiceLimit) {
        const voice = voices.shift();
        try { voice?.oscillator.stop(); } catch { /* already stopped */ }
      }
      const oscillator = context.createOscillator();
      const amplitude = context.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = frequency;
      amplitude.gain.setValueAtTime(gain, context.currentTime);
      amplitude.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + durationSeconds);
      oscillator.connect(amplitude).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + durationSeconds);
      voices.push({ oscillator, startedAt: context.currentTime });
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
