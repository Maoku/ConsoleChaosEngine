/**
 * トランジション状態機械（IMPLEMENTATION_PLAN §5.2.2、GAME_PLAN §5.1 / §5.4、T1-03）。
 *
 * 「切替中」という状態はここにしか無い。演出（ノイズ・水平同期の崩れ・音のミュート）は
 * この状態を読むだけで、状態を書き換えない。演出の実装をロジックに混ぜない（§5.2.2）。
 *
 * **無敵は型で強制する。** `invulnerable` は `true` 型なので、
 * 「無敵でない切替」を書こうとするとコンパイルエラーになる（GAME_PLAN §5.1）。
 */
import type { GenerationId } from './profiles';

/** 切替の理由。forced はエリア 5 とボス戦の一部フェーズのみ（GAME_PLAN §5.4） */
export type SwitchReason = 'player' | 'forced';

/**
 * 切替の所要時間（GAME_PLAN §5.1 / §5.4）。
 * 強制切替を長くするのは「外部要因で切り替えられている」ことを体で分からせるため。
 */
export const TRANSITION_DURATION_MS: Record<SwitchReason, number> = {
  player: 350,
  forced: 600,
};

export interface TransitionState {
  active: boolean;
  from: GenerationId;
  to: GenerationId;
  reason: SwitchReason;
  elapsedMs: number;
  durationMs: number;
  /** 常に真。型で「無敵でない切替」を書けなくする（GAME_PLAN §5.1） */
  invulnerable: true;
}

/** 切替していない状態。from === to で「両方とも現世代」を表す */
export function createTransition(current: GenerationId): TransitionState {
  return {
    active: false,
    from: current,
    to: current,
    reason: 'player',
    elapsedMs: 0,
    durationMs: TRANSITION_DURATION_MS.player,
    invulnerable: true,
  };
}

/**
 * 切替を開始する。進行中に呼ばれた場合も**新しい切替で上書きする**
 *（呼び出し側が積み替えを判断する。switcher.ts はキューを持つ）。
 */
export function beginTransition(
  state: TransitionState,
  from: GenerationId,
  to: GenerationId,
  reason: SwitchReason,
): void {
  state.active = true;
  state.from = from;
  state.to = to;
  state.reason = reason;
  state.elapsedMs = 0;
  state.durationMs = TRANSITION_DURATION_MS[reason];
}

/**
 * 時間を進める。
 * @returns この呼び出しで完了したら true（完了は 1 度しか報告しない）
 */
export function advanceTransition(state: TransitionState, dtMs: number): boolean {
  if (!state.active) return false;
  state.elapsedMs += dtMs;
  if (state.elapsedMs < state.durationMs) return false;
  // 超過分は捨てる。次の切替は必ず満尺で見せる（連打で演出が短くならないように）
  state.elapsedMs = state.durationMs;
  state.active = false;
  state.from = state.to;
  return true;
}

/** 進行度 0..1。切替していないときは 1（＝完全に現世代） */
export function transitionProgress(state: TransitionState): number {
  if (!state.active) return 1;
  if (state.durationMs <= 0) return 1;
  const t = state.elapsedMs / state.durationMs;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** 切替中は無敵（GAME_PLAN §5.1 / §5.4 の「安全性」） */
export function isInvulnerable(state: TransitionState): boolean {
  return state.active && state.invulnerable;
}
