/**
 * 投影ルールの単体テスト（IMPLEMENTATION_PLAN §5.5.4）。
 *
 * 本作で最も重要なモジュールであり、**実装より先に書く**と定められている。
 * §5.5.4 の表にある 6 ケースをすべて固定する。
 */
import { describe, it, expect } from 'vitest';
import {
  aabbFromCenter,
  createProjectionState,
  overlaps,
  recordGroundAnchor,
  resolveSwitchTo2D,
  resolveSwitchTo3D,
  zTargetForSwitchTo3D,
} from '@/gameplay/projection';

/** 中心と半径から AABB を作る短縮形 */
const box = (cx: number, cy: number, cz: number, hx = 0.5, hy = 0.5, hz = 0.5) =>
  aabbFromCenter([cx, cy, cz], [hx, hy, hz]);

describe('overlaps: 2D は Z を見ない（§5.5.1）', () => {
  it('Z が 5m 離れた 2 つの床は、XY で隣接していれば 2D では連続した床になる', () => {
    // 手前の床（z = 0）と奥の床（z = -5）。XY 投影では隣り合っている
    const near = box(0, 0, 0, 1, 0.25, 1); // x: -1..1, z: -1..1
    const far = box(2, 0, -5, 1, 0.25, 1); // x: 1..3, z: -6..-4
    const player = box(0.5, 0.7, 0, 0.4, 0.5, 0.4); // 手前の床に立っている

    // 2D: 奥の床も「同じ床の続き」として当たる
    expect(overlaps(player, far, 'ortho2d')).toBe(false); // まだ届いていない
    const stepped = box(2.0, 0.7, 0, 0.4, 0.5, 0.4); // 橋を渡り切った位置
    expect(overlaps(stepped, far, 'ortho2d')).toBe(true);

    // 3D: 奥の床とは Z が離れているので当たらない（落ちる）
    expect(overlaps(stepped, far, 'perspective3d')).toBe(false);
    // 手前の床とはどちらのモードでも当たる
    expect(overlaps(player, near, 'ortho2d')).toBe(true);
    expect(overlaps(player, near, 'perspective3d')).toBe(true);
  });

  it('Z が離れた手前の壁は、2D では Z 方向に無限の柱として通れない', () => {
    const wall = box(0, 1, 4, 0.5, 1, 0.5); // プレイヤーより手前（z = 4）にある壁
    const player = box(0, 1, 0, 0.4, 0.9, 0.4);

    expect(overlaps(player, wall, 'ortho2d')).toBe(true); // 2D では通れない
    expect(overlaps(player, wall, 'perspective3d')).toBe(false); // 3D では奥を回り込める
  });

  it('攻撃判定は Z の異なる 2 つのスイッチに 2D でのみ同時に当たる', () => {
    const attack = box(1, 1, 0, 0.8, 0.5, 0.5);
    const nearSwitch = box(1.2, 1, 0, 0.3, 0.3, 0.3);
    const farSwitch = box(1.2, 1, -6, 0.3, 0.3, 0.3);

    expect(overlaps(attack, nearSwitch, 'ortho2d')).toBe(true);
    expect(overlaps(attack, farSwitch, 'ortho2d')).toBe(true);

    expect(overlaps(attack, nearSwitch, 'perspective3d')).toBe(true);
    expect(overlaps(attack, farSwitch, 'perspective3d')).toBe(false);
  });

  it('接している（面が一致する）だけでは重なりとみなさない', () => {
    const a = box(0, 0, 0);
    const b = box(1, 0, 0); // 面がちょうど接する
    expect(overlaps(a, b, 'ortho2d')).toBe(false);
    expect(overlaps(a, b, 'perspective3d')).toBe(false);
  });
});

describe('2D → 3D の位置解決（Z アンカー方式、§5.5.3）', () => {
  it('2D で橋を渡り切って接地していれば、3D 復帰時に Z が接地面へ吸着する', () => {
    const state = createProjectionState();
    // 2D 中に奥の橋（z = -5 付近）へ接地した
    recordGroundAnchor(state, 42, [-6, -4]);

    const target = zTargetForSwitchTo3D(0, state.anchor, true);
    expect(target).not.toBeNull();
    expect(target).toBeCloseTo(-4, 6); // 区間の最も近い端へ寄せる
  });

  it('空中（接地していない）で切り替えると Z は変わらず、そのまま落下する', () => {
    const state = createProjectionState();
    recordGroundAnchor(state, 42, [-6, -4]);
    expect(zTargetForSwitchTo3D(0, state.anchor, false)).toBeNull();
  });

  it('Z がすでに接地面の区間内なら何もしない', () => {
    const state = createProjectionState();
    recordGroundAnchor(state, 7, [-6, -4]);
    expect(zTargetForSwitchTo3D(-5, state.anchor, true)).toBeNull();
  });

  it('アンカーが無ければ何もしない', () => {
    expect(zTargetForSwitchTo3D(3, null, true)).toBeNull();
  });

  it('吸着はトランジションの尺をかけて補間される（見えるように動く）', () => {
    const resolution = resolveSwitchTo3D([0, 1, 0], { entity: 1, zSpan: [-6, -4] }, true, 350);
    expect(resolution.targetZ).toBeCloseTo(-4, 6);
    expect(resolution.durationMs).toBe(350);

    // 0% / 50% / 100% の位置
    expect(resolution.zAt(0)).toBeCloseTo(0, 6);
    expect(resolution.zAt(0.5)).toBeCloseTo(-2, 6);
    expect(resolution.zAt(1)).toBeCloseTo(-4, 6);
  });
});

describe('3D → 2D の位置解決（めり込みの押し出し、§5.5.3）', () => {
  it('Z を無視した結果めり込んだソリッドから、XY の最小移動量で押し出される', () => {
    // プレイヤーの少し右、Z だけ離れた柱。2D では重なる
    const solid = box(0.6, 0, -5, 0.5, 2, 0.5);
    const player = box(0, 0, 0, 0.4, 0.9, 0.4);

    const result = resolveSwitchTo2D(player, [solid], [0, 0, 0]);
    expect(result.usedSafePosition).toBe(false);
    // X 方向へ押し出される（最小移動量）
    expect(result.position[0]).toBeLessThan(0);
    expect(result.position[1]).toBeCloseTo(0, 6);
    // 押し出し後は重なっていない
    expect(overlaps(aabbFromCenter(result.position, [0.4, 0.9, 0.4]), solid, 'ortho2d')).toBe(false);
  });

  it('四方が埋まっていれば直前の安全座標へ復帰する', () => {
    const player = box(0, 0, 0, 0.4, 0.9, 0.4);
    // 上下左右を厚い壁で塞ぐ。Z はばらばらだが 2D では無限の柱として効く。
    // どの方向へも「押し出し」と呼べる距離では抜けられない
    const cage = [
      box(-5.25, 0, -3, 5, 10, 0.5), // 左: x -10.25..-0.25
      box(5.25, 0, -6, 5, 10, 0.5), // 右: x 0.25..10.25
      box(0, -5.25, -9, 10, 5, 0.5), // 下: y -10.25..-0.25
      box(0, 5.25, -12, 10, 5, 0.5), // 上: y 0.25..10.25
    ];
    const safe: [number, number, number] = [10, 1, 0];

    const result = resolveSwitchTo2D(player, cage, safe);
    expect(result.usedSafePosition).toBe(true);
    expect(result.position).toEqual(safe);
  });

  it('めり込んでいなければ位置は変わらない', () => {
    const player = box(0, 0, 0, 0.4, 0.9, 0.4);
    const solid = box(5, 0, 0, 0.5, 0.5, 0.5);
    const result = resolveSwitchTo2D(player, [solid], [0, 0, 0]);
    expect(result.position).toEqual([0, 0, 0]);
    expect(result.usedSafePosition).toBe(false);
  });

  it('狭い隙間に挟まれても、押し出し距離が現実的な方向があれば抜ける', () => {
    // 左右の柱に挟まれ、最小移動量の押し出しだけでは振動して収束しない配置。
    // 上下（Y）へは 1.1m で抜けられるので、そちらへ逃がす
    const player = box(0, 0, 0, 0.4, 0.9, 0.4);
    const left = box(-0.7, 0, -4, 0.4, 0.2, 0.5);
    const right = box(0.7, 0, -8, 0.4, 0.2, 0.5);

    const result = resolveSwitchTo2D(player, [left, right], [9, 9, 9]);
    expect(result.usedSafePosition).toBe(false);
    expect(Math.abs(result.position[1])).toBeGreaterThan(0);
    for (const solid of [left, right]) {
      expect(overlaps(aabbFromCenter(result.position, [0.4, 0.9, 0.4]), solid, 'ortho2d')).toBe(false);
    }
  });
});

describe('不変条件', () => {
  it('2D モードでも Z 座標は保持される（I1: 世界は常に 3D）', () => {
    const player = box(0, 0, -7, 0.4, 0.9, 0.4);
    const result = resolveSwitchTo2D(player, [], [0, 0, 0]);
    expect(result.position[2]).toBe(-7);
  });

  it('同じ入力なら常に同じ結果（I4: 決定的）', () => {
    const player = box(0, 0, 0, 0.4, 0.9, 0.4);
    const solids = [box(0.6, 0, -5, 0.5, 2, 0.5), box(-0.55, 0, -9, 0.5, 2, 0.5)];
    const first = resolveSwitchTo2D(player, solids, [0, 0, 0]);
    const second = resolveSwitchTo2D(player, solids, [0, 0, 0]);
    expect(second.position).toEqual(first.position);
  });
});
