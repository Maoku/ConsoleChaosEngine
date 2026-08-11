/**
 * 楽曲の位相を世代非依存で保持する（§5.8、GAME_PLAN §9.2、T0-18）。
 *
 * **世代を切り替えても曲の位置は変わらない。** 音源だけが差し替わる。
 * そのために「今、曲のどこを鳴らしているか」を世代から独立して 1 か所で持つ。
 *
 * 基準にするのは `AudioContext.currentTime`（音の時間軸）であって、
 * ゲームループのティックではない。描画が落ちても曲は乱れない。
 */
import { scoreLengthTicks, secondsPerTick, type Score } from './score';

export interface MusicClock {
  /** 再生中か */
  readonly playing: boolean;
  /** 現在のティック位置（ループ済み、小数を含む） */
  tickAt(audioTime: number): number;
  /** 現在の小節位置（0 から。小数部が小節内の進み） */
  barAt(audioTime: number): number;
  /** 曲頭からの通算秒（ループを畳まない） */
  elapsedAt(audioTime: number): number;
  start(audioTime: number, fromTick?: number): void;
  stop(): void;
  /** 一時停止せずに曲だけ差し替える（位相を保つ）。テンポが同じことを前提にする */
  rebind(score: Score): void;
  readonly score: Score;
  readonly lengthTicks: number;
}

export function createMusicClock(score: Score): MusicClock {
  let current = score;
  let length = scoreLengthTicks(current);
  let startTime = 0;
  let startTick = 0;
  let playing = false;

  function elapsed(audioTime: number): number {
    return playing ? Math.max(audioTime - startTime, 0) : 0;
  }

  return {
    get playing() {
      return playing;
    },
    get score() {
      return current;
    },
    get lengthTicks() {
      return length;
    },
    elapsedAt: elapsed,
    tickAt(audioTime: number): number {
      const ticks = startTick + elapsed(audioTime) / secondsPerTick(current);
      return length > 0 ? ((ticks % length) + length) % length : ticks;
    },
    barAt(audioTime: number): number {
      const ticksPerBar = current.ticksPerBeat * current.beatsPerBar;
      return this.tickAt(audioTime) / ticksPerBar;
    },
    start(audioTime: number, fromTick = 0): void {
      startTime = audioTime;
      startTick = fromTick;
      playing = true;
    },
    stop(): void {
      playing = false;
    },
    rebind(next: Score): void {
      // 位相を保ったまま曲データだけを差し替える。
      // 世代ごとの編曲は「同じ Score を別の音源で鳴らす」のが原則だが、
      // 編曲違いの Score を持つ場合でもテンポと小節構造が同じなら位相は保てる。
      current = next;
      length = scoreLengthTicks(next);
    },
  };
}

/**
 * 世代切替時に位相が保たれているかを検査する（T0-18 の受け入れ条件）。
 * 切替の前後で同じ audioTime におけるティック位置が一致すれば真。
 */
export function phasePreserved(before: number, after: number, toleranceTicks = 1e-6): boolean {
  return Math.abs(before - after) <= toleranceTicks;
}
