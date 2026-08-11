import { describe, it, expect } from 'vitest';
import {
  CHECKPOINT_RADIUS,
  RESPAWN_TOTAL_TICKS,
  advanceRespawn,
  beginRespawn,
  createCheckpointState,
  fadeAmount,
  isPlayable,
  updateCheckpoints,
  type CheckpointPoint,
} from '@/gameplay/checkpoint';
import { TICK_SECONDS } from '@/core/time';
import type { Vec3 } from '@/gameplay/projection';

const HALF: Vec3 = [0.35, 0.8, 0.35];
const SPAWN: Vec3 = [0, 1, 0];

const POINTS: CheckpointPoint[] = [
  { id: 'cp_a', position: [10, 1, 0], sector: 'a' },
  // 奥行きだけが離れたチェックポイント（2D では同じ場所になる）
  { id: 'cp_b', position: [10, 1, -6], sector: 'b' },
];

describe('gameplay/checkpoint の復帰時間（§9.3：1 秒以内）', () => {
  it('復帰は 1 秒（60 ティック）以内に終わる', () => {
    expect(RESPAWN_TOTAL_TICKS).toBeLessThanOrEqual(60);
    expect(RESPAWN_TOTAL_TICKS * TICK_SECONDS).toBeLessThanOrEqual(1);
  });

  it('落下から操作可能に戻るまでの実測が 1 秒以内', () => {
    const state = createCheckpointState(SPAWN);
    expect(beginRespawn(state)).toBe(true);

    let ticks = 0;
    let restored: Vec3 | null = null;
    while (!isPlayable(state)) {
      const target = advanceRespawn(state);
      if (target) restored = target.position;
      ticks++;
      expect(ticks).toBeLessThan(120); // 無限ループ防止
    }

    expect(ticks).toBe(RESPAWN_TOTAL_TICKS);
    expect(ticks * TICK_SECONDS).toBeLessThanOrEqual(1);
    expect(restored).toEqual(SPAWN);
    expect(state.respawnCount).toBe(1);
  });

  it('復帰中は操作を受け付けない', () => {
    const state = createCheckpointState(SPAWN);
    expect(isPlayable(state)).toBe(true);
    beginRespawn(state);
    expect(isPlayable(state)).toBe(false);
    // 二重に始めても壊れない
    expect(beginRespawn(state)).toBe(false);
  });

  it('暗転しきった瞬間に位置が戻る（戻る過程は見せない）', () => {
    const state = createCheckpointState(SPAWN);
    beginRespawn(state);
    const targets: unknown[] = [];
    for (let i = 0; i < RESPAWN_TOTAL_TICKS; i++) {
      const target = advanceRespawn(state);
      if (target) targets.push({ tick: i, position: target.position });
    }
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ tick: RESPAWN_TOTAL_TICKS / 2 - 1 });
  });

  it('暗さは 0 → 1 → 0 と動く', () => {
    const state = createCheckpointState(SPAWN);
    expect(fadeAmount(state)).toBe(0);
    beginRespawn(state);
    const values: number[] = [];
    for (let i = 0; i < RESPAWN_TOTAL_TICKS; i++) {
      advanceRespawn(state);
      values.push(fadeAmount(state));
    }
    expect(Math.max(...values)).toBeCloseTo(1, 6);
    expect(values.at(-1)).toBe(0);
  });
});

describe('gameplay/checkpoint の到達', () => {
  it('触れたら復帰先が更新される', () => {
    const state = createCheckpointState(SPAWN);
    updateCheckpoints(state, POINTS, [10, 1, 0], HALF, 'perspective3d');
    expect(state.reached).toEqual(['cp_a']);
    expect(state.active).toEqual([10, 1, 0]);
  });

  it('離れた場所では反応しない', () => {
    const state = createCheckpointState(SPAWN);
    updateCheckpoints(state, POINTS, [10 - CHECKPOINT_RADIUS - HALF[0] - 0.1, 1, 0], HALF, 'perspective3d');
    expect(state.reached).toEqual([]);
    expect(state.active).toEqual(SPAWN);
  });

  it('2D では奥行きの違うチェックポイントにも触れる（投影ルールの一貫した帰結）', () => {
    const in3d = createCheckpointState(SPAWN);
    updateCheckpoints(in3d, POINTS, [10, 1, 0], HALF, 'perspective3d');
    expect(in3d.reached).toEqual(['cp_a']);

    const in2d = createCheckpointState(SPAWN);
    updateCheckpoints(in2d, POINTS, [10, 1, 0], HALF, 'ortho2d');
    expect(in2d.reached).toEqual(['cp_a', 'cp_b']);
  });

  it('同じチェックポイントを二重に記録しない', () => {
    const state = createCheckpointState(SPAWN);
    for (let i = 0; i < 5; i++) updateCheckpoints(state, POINTS, [10, 1, 0], HALF, 'perspective3d');
    expect(state.reached).toEqual(['cp_a']);
  });

  it('復帰の演出中はチェックポイントを拾わない', () => {
    const state = createCheckpointState(SPAWN);
    beginRespawn(state);
    updateCheckpoints(state, POINTS, [10, 1, 0], HALF, 'perspective3d');
    expect(state.reached).toEqual([]);
  });
});
