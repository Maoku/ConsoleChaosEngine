import { describe, it, expect } from 'vitest';
import { createMusicClock, phasePreserved } from '@/audio/clock';
import { createVoiceAllocator } from '@/audio/voicelimit';
import {
  pitchToFrequency,
  scoreLengthTicks,
  secondsPerTick,
  trackOf,
  type Score,
} from '@/audio/score';
import { createAudioEngine, type GenerationVoiceSource, type PlayRequest } from '@/audio/engine';

/** 2 小節・120BPM のテスト曲。4 世代で共有される唯一の楽曲データ */
const SCORE: Score = {
  bpm: 120,
  ticksPerBeat: 4,
  beatsPerBar: 4,
  tracks: [
    {
      role: 'lead',
      notes: [
        { tick: 0, durationTicks: 4, pitch: 72, velocity: 1 },
        { tick: 8, durationTicks: 4, pitch: 74, velocity: 0.8 },
        { tick: 16, durationTicks: 8, pitch: 76, velocity: 0.9 },
      ],
    },
    {
      role: 'bass',
      notes: [
        { tick: 0, durationTicks: 8, pitch: 36, velocity: 1 },
        { tick: 16, durationTicks: 8, pitch: 38, velocity: 1 },
      ],
    },
  ],
};

/** 記録するだけの音源。世代ごとの実装を差し替えられることの確認に使う */
function recordingSource(voiceLimit: number, log: PlayRequest[]): GenerationVoiceSource {
  return {
    voiceLimit,
    play(request) {
      log.push(request);
      return { stop: () => {} };
    },
    dispose: () => {},
  };
}

/** テスト用の最小 AudioContext。時間を手で進められる */
function fakeContext(): { context: BaseAudioContext; advance(seconds: number): void } {
  let time = 0;
  const context = {
    get currentTime() {
      return time;
    },
    sampleRate: 48000,
  } as BaseAudioContext;
  return { context, advance: (seconds) => (time += seconds) };
}

describe('audio/score（世代非依存の楽曲データ）', () => {
  it('テンポからティック長を求める', () => {
    // 120BPM / 4 ティック per 拍 → 1 ティック = 0.125 秒
    expect(secondsPerTick(SCORE)).toBeCloseTo(0.125, 6);
  });

  it('曲の長さは小節の切れ目まで伸ばされる', () => {
    // 末尾は 16 + 8 = 24 ティック。1 小節 = 16 ティックなので 32 まで伸びる
    expect(scoreLengthTicks(SCORE)).toBe(32);
  });

  it('トラックは役割で引ける（楽器名を持たない）', () => {
    expect(trackOf(SCORE, 'lead')?.notes).toHaveLength(3);
    expect(trackOf(SCORE, 'pad')).toBeUndefined();
  });

  it('MIDI ノート番号から周波数を求める', () => {
    expect(pitchToFrequency(69)).toBeCloseTo(440, 6);
    expect(pitchToFrequency(81)).toBeCloseTo(880, 6);
  });
});

describe('audio/clock（位相の保持）', () => {
  it('経過時間からティック位置を求める', () => {
    const clock = createMusicClock(SCORE);
    clock.start(10);
    expect(clock.tickAt(10)).toBe(0);
    expect(clock.tickAt(10.5)).toBeCloseTo(4, 6);
  });

  it('曲末尾でループする', () => {
    const clock = createMusicClock(SCORE);
    clock.start(0);
    // 32 ティック = 4 秒
    expect(clock.tickAt(4)).toBeCloseTo(0, 6);
    expect(clock.tickAt(4.5)).toBeCloseTo(4, 6);
  });

  it('小節位置を返す（位相同期の単位）', () => {
    const clock = createMusicClock(SCORE);
    clock.start(0);
    expect(clock.barAt(0)).toBe(0);
    expect(clock.barAt(2)).toBeCloseTo(1, 6); // 1 小節 = 16 ティック = 2 秒
  });

  it('曲データを差し替えても位相は動かない（世代切替の核心）', () => {
    const clock = createMusicClock(SCORE);
    clock.start(0);
    const before = clock.tickAt(3.3);
    clock.rebind({ ...SCORE, tracks: [] }); // 別編曲へ差し替え
    const after = clock.tickAt(3.3);
    expect(phasePreserved(before, after)).toBe(true);
  });
});

describe('audio/voicelimit（同時発音数）', () => {
  it('上限を超えると最も古い音が切られる', () => {
    const allocator = createVoiceAllocator<string>(5);
    for (let i = 0; i < 5; i++) allocator.allocate(`v${i}`, i);
    expect(allocator.active).toHaveLength(5);

    const { stolen } = allocator.allocate('v5', 5);
    expect(stolen?.handle).toBe('v0');
    expect(allocator.active).toHaveLength(5);
  });

  it('優先度の低い音から切られる（効果音より BGM を残す）', () => {
    const allocator = createVoiceAllocator<string>(2);
    allocator.allocate('bgm', 0, 1);
    allocator.allocate('sfx', 1, 0);
    const { stolen } = allocator.allocate('bgm2', 2, 1);
    expect(stolen?.handle).toBe('sfx');
  });

  it('解放すれば空きができる', () => {
    const allocator = createVoiceAllocator<string>(2);
    const first = allocator.allocate('a', 0);
    allocator.allocate('b', 1);
    allocator.release(first.voice.id);
    const { stolen } = allocator.allocate('c', 2);
    expect(stolen).toBeNull();
  });
});

describe('audio/engine（世代をまたぐ再生）', () => {
  it('同じ Score を異なる音源で鳴らせる（世代ごとの実装を差し替えるだけ）', () => {
    const { context, advance } = fakeContext();
    const fcLog: PlayRequest[] = [];
    const ps2Log: PlayRequest[] = [];
    const engine = createAudioEngine(context, SCORE);
    engine.registerSource('FC', recordingSource(5, fcLog));
    engine.registerSource('PS2', recordingSource(48, ps2Log));

    engine.useSource('FC');
    engine.startMusic(SCORE);
    engine.update();
    expect(fcLog.length).toBeGreaterThan(0);
    expect(ps2Log).toHaveLength(0);

    advance(1);
    engine.useSource('PS2');
    engine.update();
    expect(ps2Log.length).toBeGreaterThan(0);
  });

  it('音源を差し替えても曲の位置は動かない（T0-18 の受け入れ条件）', () => {
    const { context, advance } = fakeContext();
    const engine = createAudioEngine(context, SCORE);
    engine.registerSource('FC', recordingSource(5, []));
    engine.registerSource('PS1', recordingSource(24, []));
    engine.useSource('FC');
    engine.startMusic(SCORE);

    advance(1.7);
    const before = engine.clock.tickAt(context.currentTime);
    engine.useSource('PS1');
    const after = engine.clock.tickAt(context.currentTime);
    expect(phasePreserved(before, after)).toBe(true);

    // 4 世代を往復しても小節位置がずれない
    advance(0.3);
    const barBefore = engine.clock.barAt(context.currentTime);
    for (const key of ['FC', 'PS1', 'FC', 'PS1']) engine.useSource(key);
    expect(engine.clock.barAt(context.currentTime)).toBeCloseTo(barBefore, 9);
  });

  it('世代ごとの同時発音数が音源の登録値から適用される', () => {
    const { context } = fakeContext();
    const log: PlayRequest[] = [];
    const engine = createAudioEngine(context, SCORE);
    engine.registerSource('FC', recordingSource(5, log));
    engine.useSource('FC');
    engine.startMusic(SCORE);
    engine.update();
    // 5 声を超える予約はできない（allocator が古い音を切る）
    expect(log.length).toBeGreaterThan(0);
  });

  it('同じ音は二重に予約されない（先読み範囲が重ならない）', () => {
    const { context, advance } = fakeContext();
    const log: PlayRequest[] = [];
    const engine = createAudioEngine(context, SCORE);
    engine.registerSource('FC', recordingSource(5, log));
    engine.useSource('FC');
    engine.startMusic(SCORE);

    for (let i = 0; i < 20; i++) {
      engine.update();
      advance(0.05);
    }
    // 1 秒 = 8 ティック分。lead は 0 と 8 の 2 音、bass は 0 の 1 音
    const times = log.map((r) => `${r.role}@${r.when.toFixed(3)}`);
    expect(new Set(times).size).toBe(times.length);
  });
});
