/**
 * テスト用の最小 Web Audio 実装（T1-16）。
 *
 * Node には Web Audio が無いので、音源が「どんなノードを、いつ鳴らしたか」だけを
 * 記録する偽物を用意する。音そのものは検証せず、聴感の結論は公開検証要約へ反映する。
 * 検証するのは **世代ごとに構成が変わること** と **同時発音数・位相の約束**。
 */

export interface FakeSourceLog {
  kind: 'oscillator' | 'buffer';
  startedAt: number;
  stoppedAt: number | null;
  /** oscillator の波形種別、または再生したバッファのサンプリング周波数 */
  detail: string | number;
}

export interface FakeAudioContext {
  context: BaseAudioContext;
  advance(seconds: number): void;
  readonly sources: FakeSourceLog[];
  readonly nodeCounts: Record<string, number>;
  reset(): void;
}

function makeParam(): AudioParam {
  return {
    value: 0,
    setValueAtTime() {
      return this as unknown as AudioParam;
    },
    setTargetAtTime() {
      return this as unknown as AudioParam;
    },
    linearRampToValueAtTime() {
      return this as unknown as AudioParam;
    },
    exponentialRampToValueAtTime() {
      return this as unknown as AudioParam;
    },
    cancelScheduledValues() {
      return this as unknown as AudioParam;
    },
  } as unknown as AudioParam;
}

export function createFakeAudio(sampleRate = 48000): FakeAudioContext {
  let time = 0;
  const sources: FakeSourceLog[] = [];
  const nodeCounts: Record<string, number> = {};

  function count(kind: string): void {
    nodeCounts[kind] = (nodeCounts[kind] ?? 0) + 1;
  }

  function baseNode(kind: string): Record<string, unknown> {
    count(kind);
    return {
      connect: (node: unknown) => node,
      disconnect: () => {},
    };
  }

  const context = {
    get currentTime() {
      return time;
    },
    sampleRate,
    destination: { connect: () => {}, disconnect: () => {} },
    createGain() {
      return { ...baseNode('gain'), gain: makeParam() };
    },
    createOscillator() {
      const log: FakeSourceLog = { kind: 'oscillator', startedAt: 0, stoppedAt: null, detail: 'square' };
      return {
        ...baseNode('oscillator'),
        type: 'square',
        frequency: makeParam(),
        setPeriodicWave(wave: { type?: string }) {
          log.detail = wave.type ?? 'periodic';
        },
        start(when = 0) {
          log.startedAt = when;
          sources.push(log);
        },
        stop(when = 0) {
          log.stoppedAt = when;
        },
      };
    },
    createBufferSource() {
      const log: FakeSourceLog = { kind: 'buffer', startedAt: 0, stoppedAt: null, detail: 0 };
      return {
        ...baseNode('bufferSource'),
        buffer: null as AudioBuffer | null,
        loop: false,
        playbackRate: makeParam(),
        start(when = 0) {
          log.startedAt = when;
          log.detail = (this as { buffer: AudioBuffer | null }).buffer?.sampleRate ?? 0;
          sources.push(log);
        },
        stop(when = 0) {
          log.stoppedAt = when;
        },
      };
    },
    createBuffer(channels: number, length: number, rate: number) {
      count('buffer');
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate: rate,
        duration: length / rate,
        getChannelData: (channel: number) => data[channel]!,
      };
    },
    createPeriodicWave() {
      count('periodicWave');
      return { type: 'periodic' };
    },
    createConvolver() {
      return { ...baseNode('convolver'), buffer: null as AudioBuffer | null };
    },
    createPanner() {
      return {
        ...baseNode('panner'),
        panningModel: 'equalpower',
        positionX: makeParam(),
        positionY: makeParam(),
        positionZ: makeParam(),
      };
    },
  };

  return {
    context: context as unknown as BaseAudioContext,
    advance: (seconds: number) => {
      time += seconds;
    },
    sources,
    nodeCounts,
    reset(): void {
      sources.length = 0;
      for (const key of Object.keys(nodeCounts)) delete nodeCounts[key];
    },
  };
}
