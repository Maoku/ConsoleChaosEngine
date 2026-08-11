/**
 * オーディオエンジン（§5.8、T0-17 / T0-18）。
 *
 * 役割：
 * - AudioContext の管理（ブラウザ差異の吸収を含む）
 * - 世代別の音源を束ね、切替時に**位相を保ったまま**差し替える
 * - 先読みスケジューラ（音の予約はゲームループのフレームレートに依存しない）
 *
 * 世代の分岐はここに書かない。音源は `GenerationVoiceSource` として登録され、
 * 差し替えは「どの音源にノートを渡すか」だけの違いになる。
 */
import { createMusicClock, type MusicClock } from './clock';
import { createVoiceAllocator, type VoiceAllocator } from './voicelimit';
import { notesInRange, pitchToFrequency, secondsPerTick, type Score, type TrackRole } from './score';

/** 何秒先まで音を予約するか。長いほど安全だが、切替の反映が遅れる */
export const LOOKAHEAD_SECONDS = 0.12;
/** スケジューラを回す間隔（秒）。ゲームループから呼ばれる想定 */
export const SCHEDULE_INTERVAL_SECONDS = 0.05;

export interface PlayRequest {
  role: TrackRole;
  frequency: number;
  when: number;
  durationSeconds: number;
  velocity: number;
  /** 定位 -1..1。定位を持たない音源は無視する（第4世代の PannerNode 用。T1-16） */
  pan?: number;
}

export interface VoiceHandle {
  stop(when: number): void;
}

/**
 * 音源を作るときに渡す値（T1-16）。
 * `AudioProfile` の写しだが、engine / 各音源は世代を知らないままでいられる。
 */
export interface VoiceSourceOptions {
  voiceLimit: number;
  /** 0 は「サンプルを持たない」（合成のみ） */
  sampleRate: number;
  reverb: boolean;
  positional: boolean;
}

/** 世代ごとの音源。engine はこのインターフェースしか知らない */
export interface GenerationVoiceSource {
  readonly voiceLimit: number;
  play(request: PlayRequest): VoiceHandle;
  dispose(): void;
}

export interface AudioEngine {
  readonly context: BaseAudioContext;
  readonly clock: MusicClock;
  /** 現在の音源に付けた名前（世代 ID を渡す想定だが、engine は意味を知らない） */
  readonly currentSourceKey: string | null;
  registerSource(key: string, source: GenerationVoiceSource): void;
  /** 音源を差し替える。曲の位相は保たれる（GAME_PLAN §9.2） */
  useSource(key: string): void;
  /**
   * 編曲を差し替える（T1-16）。テンポと小節構造が同じなら位相は保たれる。
   * 音源の差し替えと合わせて呼ぶことで「同じ曲が、その時代の音と編成で鳴る」になる。
   */
  useArrangement(score: Score): void;
  /**
   * 効果音などの単発音を今すぐ予約する（T1-16）。
   * BGM より低い優先度で確保するので、声が足りない世代では
   * 効果音どうしが先に食い合い、それでも足りなければ BGM のパートが一時的に消える。
   */
  playOneShot(request: PlayRequest): void;
  startMusic(score: Score, fromTick?: number): void;
  stopMusic(): void;
  /** 先読みスケジューリング。毎ティック呼ぶ */
  update(): void;
  dispose(): void;
}

export function createAudioEngine(context: BaseAudioContext, score: Score): AudioEngine {
  const clock: MusicClock = createMusicClock(score);
  const sources = new Map<string, GenerationVoiceSource>();
  let currentKey: string | null = null;
  let allocator: VoiceAllocator<VoiceHandle> = createVoiceAllocator<VoiceHandle>(1);
  /** どのティックまで予約済みか（曲頭からの通算。ループを畳まない） */
  let scheduledUntilTick = 0;
  /** 再生開始位置。通算ティックを求めるために覚えておく */
  let startTick = 0;

  function source(): GenerationVoiceSource | null {
    return currentKey === null ? null : (sources.get(currentKey) ?? null);
  }

  /**
   * 曲頭からの通算ティック（ループを畳まない）。
   * `clock.tickAt` はループ後に 0 へ戻るため、予約位置の管理には使えない
   *（畳んだ値と比べると、ループをまたいだ瞬間に予約が止まる）。
   */
  function absoluteTick(audioTime: number): number {
    return startTick + clock.elapsedAt(audioTime) / secondsPerTick(clock.score);
  }

  function scheduleWindow(fromTick: number, toTick: number, tickToTime: (tick: number) => number): void {
    const active = source();
    if (!active) return;
    const current = clock.score;
    const spt = secondsPerTick(current);
    const length = clock.lengthTicks;

    for (const track of current.tracks) {
      // ループを跨ぐ場合は 2 区間に分けて拾う
      const ranges: Array<[number, number]> = [];
      const from = fromTick % length;
      const to = from + (toTick - fromTick);
      if (to <= length) ranges.push([from, to]);
      else {
        ranges.push([from, length]);
        ranges.push([0, to - length]);
      }

      let offset = 0;
      for (const [rangeStart, rangeEnd] of ranges) {
        for (const note of notesInRange(track, rangeStart, rangeEnd)) {
          const when = tickToTime(fromTick + (note.tick - rangeStart) + offset);
          const { stolen } = allocator.allocate(
            active.play({
              role: track.role,
              frequency: pitchToFrequency(note.pitch),
              when,
              durationSeconds: note.durationTicks * spt,
              velocity: note.velocity,
            }),
            when,
            track.role === 'fx' ? 0 : 1, // 効果音より BGM を残す
          );
          // 上限を超えた場合、古い音を切る（実機の発音数制限）
          stolen?.handle.stop(when);
        }
        offset += rangeEnd - rangeStart;
      }
    }
  }

  return {
    context,
    clock,
    get currentSourceKey() {
      return currentKey;
    },
    registerSource(key, generationSource): void {
      sources.set(key, generationSource);
    },
    useSource(key): void {
      if (!sources.has(key)) throw new Error(`未登録の音源: ${key}`);
      // 位相は clock が持っているため、音源を差し替えても曲の位置は動かない。
      // 鳴っている音は切り、次の予約から新しい音源で鳴らす。
      const now = context.currentTime;
      for (const voice of allocator.releaseAll()) voice.handle.stop(now);
      currentKey = key;
      const next = sources.get(key)!;
      allocator = createVoiceAllocator<VoiceHandle>(next.voiceLimit);
      // 切替直後の空白を避けるため、予約済み位置を現在位置まで巻き戻す
      scheduledUntilTick = absoluteTick(now);
    },
    useArrangement(nextScore): void {
      // 位相は clock が持つ。編曲を差し替えても小節位置は動かない（T1-16 の受け入れ条件）
      clock.rebind(nextScore);
      scheduledUntilTick = Math.max(scheduledUntilTick, absoluteTick(context.currentTime));
    },
    playOneShot(request): void {
      const active = source();
      if (!active) return;
      const { stolen } = allocator.allocate(active.play(request), request.when, 0);
      stolen?.handle.stop(request.when);
    },
    startMusic(nextScore, fromTick = 0): void {
      clock.rebind(nextScore);
      clock.start(context.currentTime, fromTick);
      startTick = fromTick;
      scheduledUntilTick = fromTick;
    },
    stopMusic(): void {
      const now = context.currentTime;
      for (const voice of allocator.releaseAll()) voice.handle.stop(now);
      clock.stop();
    },
    update(): void {
      if (!clock.playing) return;
      const now = context.currentTime;
      const spt = secondsPerTick(clock.score);
      const currentTick = absoluteTick(now);
      const horizonTick = currentTick + LOOKAHEAD_SECONDS / spt;
      if (horizonTick <= scheduledUntilTick) return;

      const from = Math.max(scheduledUntilTick, currentTick);
      scheduleWindow(from, horizonTick, (tick) => now + (tick - currentTick) * spt);
      scheduledUntilTick = horizonTick;
    },
    dispose(): void {
      this.stopMusic();
      for (const generationSource of sources.values()) generationSource.dispose();
      sources.clear();
    },
  };
}
