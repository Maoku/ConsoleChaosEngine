import {
  createDeviceSnapshot,
  createTransportClock,
  type AudioService,
  type DeviceInputSource,
  type DeviceSnapshot,
  type FrameRenderer,
  type GenerationController,
  type HardwareGenerationProfile,
  type LoopHost,
  type RenderFrame,
  type Score,
} from '@console-chaos/engine';

export interface ManualLoopHost extends LoopHost {
  setNow(value: number): void;
  setHidden(value: boolean): void;
  runFrame(): void;
}

export function createManualLoopHost(): ManualLoopHost {
  let now = 0;
  let hidden = false;
  let callback: (() => void) | null = null;
  return {
    now: () => now,
    requestFrame(next): number {
      callback = next;
      return 1;
    },
    cancelFrame(): void {
      callback = null;
    },
    isHidden: () => hidden,
    setNow: (value) => (now = value),
    setHidden: (value) => (hidden = value),
    runFrame(): void {
      const next = callback;
      callback = null;
      next?.();
    },
  };
}

export interface RecordingRenderer extends FrameRenderer {
  readonly frames: Array<{ meshes: number; sprites: number; overlays: number; generation: string }>;
}

export function createRecordingRenderer(): RecordingRenderer {
  const frames: RecordingRenderer['frames'] = [];
  return {
    frames,
    render(frame: RenderFrame, profile: HardwareGenerationProfile, _generation: GenerationController): void {
      frames.push({ meshes: frame.meshes.length, sprites: frame.sprites.length, overlays: frame.overlays.length, generation: profile.id });
    },
    resize: () => {},
    dispose: () => {},
  };
}

export interface MutableInputSource extends DeviceInputSource {
  set(snapshot: DeviceSnapshot): void;
}

export function createMutableInputSource(): MutableInputSource {
  let snapshot = createDeviceSnapshot();
  return {
    poll: () => snapshot,
    set: (next) => (snapshot = next),
    dispose: () => {},
  };
}

export interface RecordingAudioService extends AudioService {
  readonly tones: Array<{ frequency: number; duration: number; gain: number }>;
  readonly profiles: HardwareGenerationProfile[];
  readonly scores: Score[];
  advance(seconds: number): void;
}

export function createRecordingAudioService(bpm = 120): RecordingAudioService {
  let time = 0;
  let sourceKey: string | null = null;
  const tones: RecordingAudioService['tones'] = [];
  const profiles: HardwareGenerationProfile[] = [];
  const scores: Score[] = [];
  const clock = createTransportClock(bpm);
  clock.start(0);
  return {
    get currentTime() {
      return time;
    },
    clock,
    get currentSourceKey() {
      return sourceKey;
    },
    get barPosition() {
      return clock.barAt(time);
    },
    tones,
    profiles,
    scores,
    unlock: async () => {},
    setGenerationVoiceLimit: () => {},
    setGenerationProfile: (profile) => {
      profiles.push(profile);
      sourceKey = profile.audio.synth;
    },
    playScore: (score) => scores.push(score),
    useScore: (score) => scores.push(score),
    playOneShot: (request) => tones.push({
      frequency: request.frequency,
      duration: request.durationSeconds,
      gain: request.velocity,
    }),
    playTone: (frequency, duration, gain = 0.04) => tones.push({ frequency, duration, gain }),
    setMuted: () => {},
    setVolume: () => {},
    update: () => {},
    dispose: () => {},
    advance: (seconds) => (time += seconds),
  };
}
