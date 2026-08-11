/**
 * 同時発音数の制限（§5.8、GAME_PLAN §9）。
 *
 * 世代ごとの同時発音数（5 / 8 / 24 / 48）をここに集約する。
 * 超過時は**古い音を切る**。これも「制約は入出力にのみかける」（ピラー P1）の一部で、
 * 第1世代では効果音が鳴ると BGM のパートが一時的に消える、という実機の挙動になる。
 */

export interface Voice<T> {
  id: number;
  /** 発音開始時刻（AudioContext の時間軸） */
  startedAt: number;
  /** 優先度。高いほど残る。効果音より BGM を残したい場合などに使う */
  priority: number;
  handle: T;
}

export interface VoiceAllocator<T> {
  readonly limit: number;
  readonly active: readonly Voice<T>[];
  /**
   * 発音を要求する。上限を超える場合は最も古い（優先度の低い）音を止めて場所を空ける。
   * @returns 止められた音。呼び出し側が停止処理を行う
   */
  allocate(handle: T, startedAt: number, priority?: number): { voice: Voice<T>; stolen: Voice<T> | null };
  /** 発音の終了を通知する */
  release(id: number): void;
  releaseAll(): Voice<T>[];
}

export function createVoiceAllocator<T>(limit: number): VoiceAllocator<T> {
  const voices: Voice<T>[] = [];
  let nextId = 1;

  return {
    limit,
    get active() {
      return voices;
    },
    allocate(handle, startedAt, priority = 0) {
      let stolen: Voice<T> | null = null;
      if (voices.length >= limit) {
        // 優先度が最も低く、その中で最も古いものを切る
        let index = 0;
        for (let i = 1; i < voices.length; i++) {
          const candidate = voices[i]!;
          const current = voices[index]!;
          if (
            candidate.priority < current.priority ||
            (candidate.priority === current.priority && candidate.startedAt < current.startedAt)
          ) {
            index = i;
          }
        }
        stolen = voices.splice(index, 1)[0] ?? null;
      }
      const voice: Voice<T> = { id: nextId++, startedAt, priority, handle };
      voices.push(voice);
      return { voice, stolen };
    },
    release(id): void {
      const index = voices.findIndex((voice) => voice.id === id);
      if (index >= 0) voices.splice(index, 1);
    },
    releaseAll(): Voice<T>[] {
      const all = [...voices];
      voices.length = 0;
      return all;
    },
  };
}
