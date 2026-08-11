/**
 * セッションの状態変化 → 効果音（T1-16）。
 *
 * **音を鳴らすのはここではない。「何が起きたか」を並べるだけ。**
 * 実際の発音は `audio/director.ts` が世代プロファイルに従って行う。
 * こう分けておくと、リプレイ（音を鳴らさない）でも同じ判定を通せる。
 *
 * IMPLEMENTATION_PLAN §3 のツリーには無いファイル。§5.8 の `sfx.ts` は
 * 「どんな音か」を持つが、「いつ鳴るか」を持つ場所がどこにも無い。
 * main.ts（ブートストラップのみ）には置けないので T1-16 で新設した。
 *
 * 判定はすべて**前ティックとの差分**で、セッションを書き換えない。
 */
import type { SfxId } from '@/audio/sfx';
import type { Session } from './session';

export interface CueTracker {
  grounded: boolean;
  risingY: boolean;
  solvedCount: number;
  checkpointCount: number;
  respawnCount: number;
  generation: string;
  hintStage: number;
  warning: boolean;
}

export function createCueTracker(): CueTracker {
  return {
    grounded: true,
    risingY: false,
    solvedCount: 0,
    checkpointCount: 0,
    respawnCount: 0,
    generation: '',
    hintStage: 0,
    warning: false,
  };
}

/**
 * 前回の呼び出しからの変化を効果音の並びにする。毎ティック 1 回呼ぶ。
 * 並び順は「起きた順」ではなく固定順で、同じ状態からは常に同じ並びが出る（不変条件 I4）。
 */
export function pollCues(tracker: CueTracker, session: Session): SfxId[] {
  const cues: SfxId[] = [];
  const player = session.player;

  // 接地 → 空中で、上向きに動いていればジャンプ。空中 → 接地なら着地
  const rising = player.velocity[1] > 0;
  if (tracker.grounded && !player.grounded && rising) cues.push('jump');
  if (!tracker.grounded && player.grounded) cues.push('land');
  tracker.grounded = player.grounded;
  tracker.risingY = rising;

  if (session.switcher.generation !== tracker.generation) {
    // 最初のティックでは鳴らさない（起動音にしない）
    if (tracker.generation !== '') cues.push('switch');
    tracker.generation = session.switcher.generation;
  }

  const warning = session.switcher.warningRemainingMs !== null;
  if (warning && !tracker.warning) cues.push('warning');
  tracker.warning = warning;

  if (session.solved.size > tracker.solvedCount) cues.push('solve');
  tracker.solvedCount = session.solved.size;

  const checkpoints = session.checkpoints.reached.length;
  if (checkpoints > tracker.checkpointCount) cues.push('checkpoint');
  tracker.checkpointCount = checkpoints;

  if (session.checkpoints.respawnCount > tracker.respawnCount) cues.push('respawn');
  tracker.respawnCount = session.checkpoints.respawnCount;

  const stage = session.hints.message?.stage ?? 0;
  if (stage > tracker.hintStage) cues.push('hint');
  tracker.hintStage = stage;

  return cues;
}

/**
 * 効果音の定位（-1..1）。定位を持たない世代では director 側で無視される。
 * 画面の左右のどちらで起きたかを、プレイヤーからの X 差で決める。
 */
export function panOf(session: Session, worldX: number, halfWidthMeters = 8): number {
  const offset = (worldX - session.player.position[0]) / halfWidthMeters;
  return Math.max(-1, Math.min(1, offset));
}
