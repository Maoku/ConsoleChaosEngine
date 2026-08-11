/**
 * チェックポイントと復帰（GAME_PLAN §6.6-4、IMPLEMENTATION_PLAN §9.3、T1-15）。
 *
 * **失敗しても即死させない。落下は直前のチェックポイントへ 1 秒で復帰する。**
 * 「難しさは"どの世代を試すか"に置き、実行難度は低く保つ」（GAME_PLAN §6.6-1）という
 * 方針の裏返しで、やり直しの摩擦を限りなく小さくするための仕組み。
 *
 * 復帰の内訳（1 秒 = 60 ティックの予算に対して）:
 *   落下判定 → 暗転 12 ティック（0.2 秒）→ 位置を戻す → 明転 12 ティック（0.2 秒）
 * 合計 24 ティック（0.4 秒）で操作可能に戻る。演出を足しても 1 秒には収まる。
 */
import { aabbFromCenter, overlaps, type ProjectionMode, type Vec3 } from './projection';

/** レベルデータのチェックポイント 1 件（`level/schema.ts` の LevelCheckpoint と同じ形） */
export interface CheckpointPoint {
  id: string;
  position: Vec3;
  sector: string;
}

/** 触れたと見なす範囲（メートル）。旗に正確に重なる必要はない */
export const CHECKPOINT_RADIUS = 1.0;

/** 暗転・明転のティック数。合計が 1 秒（60 ティック）を超えてはならない */
export const RESPAWN_FADE_OUT_TICKS = 12;
export const RESPAWN_FADE_IN_TICKS = 12;

/** 復帰にかかる合計ティック。§9.3 の「1 秒以内」を機械的に守るための定数 */
export const RESPAWN_TOTAL_TICKS = RESPAWN_FADE_OUT_TICKS + RESPAWN_FADE_IN_TICKS;

export type RespawnPhase = 'playing' | 'fadeOut' | 'fadeIn';

export interface CheckpointState {
  /** 復帰先。まだ 1 つも触れていなければ出現位置 */
  active: Vec3;
  /** 触れたチェックポイントの id（到達順） */
  reached: string[];
  phase: RespawnPhase;
  /** 現在の段階の残りティック */
  remainingTicks: number;
  /** 復帰した回数（計測用） */
  respawnCount: number;
}

export function createCheckpointState(spawn: Vec3): CheckpointState {
  return {
    active: [...spawn] as Vec3,
    reached: [],
    phase: 'playing',
    remainingTicks: 0,
    respawnCount: 0,
  };
}

/** 操作を受け付けてよいか（復帰の演出中は入力を無視する） */
export function isPlayable(state: CheckpointState): boolean {
  return state.phase === 'playing';
}

/** 画面を覆う暗さ 0..1。UI が読む（実装は T1-18） */
export function fadeAmount(state: CheckpointState): number {
  if (state.phase === 'fadeOut') {
    return 1 - state.remainingTicks / RESPAWN_FADE_OUT_TICKS;
  }
  if (state.phase === 'fadeIn') {
    return state.remainingTicks / RESPAWN_FADE_IN_TICKS;
  }
  return 0;
}

/**
 * 触れたチェックポイントを有効にする。
 * **判定は `projection.overlaps` を通す**ので、2D では Z が無視される（§5.6）。
 * 奥行きの違うチェックポイントに 2D で触れてしまうが、それは投影ルールの一貫した帰結。
 */
export function updateCheckpoints(
  state: CheckpointState,
  points: readonly CheckpointPoint[],
  position: Vec3,
  halfExtents: Vec3,
  mode: ProjectionMode,
): void {
  if (state.phase !== 'playing') return;
  const body = aabbFromCenter(position, halfExtents);
  for (const point of points) {
    const box = aabbFromCenter(point.position, [CHECKPOINT_RADIUS, CHECKPOINT_RADIUS, CHECKPOINT_RADIUS]);
    if (!overlaps(body, box, mode)) continue;
    if (!state.reached.includes(point.id)) state.reached.push(point.id);
    // 常に「直前に触れたもの」を復帰先にする（戻ったら前のに戻る方が挙動が読める）
    state.active = [...point.position] as Vec3;
  }
}

/** 落下などで復帰を始める。すでに復帰中なら何もしない */
export function beginRespawn(state: CheckpointState): boolean {
  if (state.phase !== 'playing') return false;
  state.phase = 'fadeOut';
  state.remainingTicks = RESPAWN_FADE_OUT_TICKS;
  return true;
}

export interface RespawnTarget {
  position: Vec3;
  velocity: Vec3;
}

/**
 * 復帰の進行を 1 ティック進める。
 * @returns 位置を戻すべきタイミングなら復帰先を返す（暗転が終わった瞬間の 1 回だけ）
 */
export function advanceRespawn(state: CheckpointState): RespawnTarget | null {
  if (state.phase === 'playing') return null;

  state.remainingTicks--;
  if (state.remainingTicks > 0) return null;

  if (state.phase === 'fadeOut') {
    state.phase = 'fadeIn';
    state.remainingTicks = RESPAWN_FADE_IN_TICKS;
    state.respawnCount++;
    // 暗転しきった瞬間に位置を戻す。プレイヤーには「戻る過程」が見えない
    return { position: [...state.active] as Vec3, velocity: [0, 0, 0] };
  }

  state.phase = 'playing';
  state.remainingTicks = 0;
  return null;
}
