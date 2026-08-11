import { describe, it, expect } from 'vitest';
import {
  GRAVITY,
  MAX_FALL_SPEED,
  StaticBody,
  physicsSystem,
  solidsFor,
  stepBody,
  triggersFor,
  type MovingBody,
  type SolidHit,
} from '@/gameplay/physics';
import {
  aabbFromCenter,
  createProjectionState,
  overlaps,
  resolveSwitchTo3D,
  type Vec3,
} from '@/gameplay/projection';
import { PlayerBody, type PlayerBodyData } from '@/gameplay/player';
import { createWorld } from '@/core/ecs/world';
import { TICK_SECONDS } from '@/core/time';

function body(position: Vec3, velocity: Vec3 = [0, 0, 0], half: Vec3 = [0.35, 0.8, 0.35]): MovingBody {
  return { position: [...position], velocity: [...velocity], halfExtents: [...half], grounded: false, wallDirection: 0 };
}

/** 静的な当たり判定。entity 番号はテスト内で一意ならよい */
function solid(entity: number, center: Vec3, half: Vec3): SolidHit {
  return { entity, box: aabbFromCenter(center, half) };
}

/** 重力を切って、指定した速度だけで動かす（移動の検証を重力から切り離す） */
const NO_GRAVITY = { gravity: 0 } as const;

describe('gameplay/physics のスイープ（トンネリング防止、§5.6 の受け入れ条件）', () => {
  it('1 ティックで薄い壁を跨ぐ速度でも素通りしない', () => {
    // 厚さ 0.1m の壁。速度 300m/s は 1 ティックで 5m 進み、壁の厚みを大きく跨ぐ
    const wall = solid(1, [5, 0, 0], [0.05, 3, 3]);
    const moving = body([0, 0, 0], [300, 0, 0]);
    stepBody(moving, [wall], { mode: 'perspective3d', ...NO_GRAVITY });

    expect(moving.position[0]).toBeCloseTo(5 - 0.05 - 0.35, 6);
    expect(moving.velocity[0]).toBe(0);
    expect(overlaps(aabbFromCenter(moving.position, moving.halfExtents), wall.box, 'perspective3d')).toBe(false);
  });

  it('薄い床へ終端速度で落ちても抜けない', () => {
    // 終端速度 30m/s は 1 ティックで 0.5m 落ちる。厚さ 0.1m の床は掃過なしなら跨いでしまう
    const floor = solid(1, [0, -0.9, 0], [4, 0.05, 4]);
    const moving = body([0, 0, 0], [0, -MAX_FALL_SPEED, 0]);
    stepBody(moving, [floor], { mode: 'perspective3d', ...NO_GRAVITY });

    expect(moving.position[1]).toBeCloseTo(-0.85 + 0.8, 6);
    expect(moving.grounded).toBe(true);
    expect(overlaps(aabbFromCenter(moving.position, moving.halfExtents), floor.box, 'perspective3d')).toBe(false);
  });

  it('落下速度には終端がある（掃過の範囲を抑える）', () => {
    const moving = body([0, 0, 0]);
    for (let i = 0; i < 300; i++) stepBody(moving, [], { mode: 'perspective3d' });
    expect(moving.velocity[1]).toBe(-MAX_FALL_SPEED);
  });

  it('遅い移動では普通に進む（当たらなければ全量動く）', () => {
    const moving = body([0, 0, 0], [4, 0, 0]);
    stepBody(moving, [], { mode: 'perspective3d', ...NO_GRAVITY });
    expect(moving.position[0]).toBeCloseTo(4 * TICK_SECONDS, 6);
  });
});

describe('gameplay/physics の軸分離（§5.6：X → Y →（3D のみ）Z）', () => {
  it('斜めに角へ突っ込んでも、両軸で止まってめり込まない', () => {
    const wall = solid(1, [1.5, 0, 0], [0.5, 2, 2]);
    const floor = solid(2, [0, -1.5, 0], [4, 0.5, 4]);
    // 1 ティックで X に 1m、Y に 1m 進む速度。どちらの軸も接触する
    const moving = body([0, 0, 0], [60, -60, 0]);
    stepBody(moving, [wall, floor], { mode: 'perspective3d', ...NO_GRAVITY });

    const box = aabbFromCenter(moving.position, moving.halfExtents);
    expect(overlaps(box, wall.box, 'perspective3d')).toBe(false);
    expect(overlaps(box, floor.box, 'perspective3d')).toBe(false);
    expect(moving.grounded).toBe(true);
    expect(moving.wallDirection).toBe(1);
  });

  it('2D 投影の世代では Z 方向へ動かない（§5.5.1）', () => {
    const moving = body([0, 0, 0], [0, 0, 5]);
    stepBody(moving, [], { mode: 'ortho2d', ...NO_GRAVITY });
    expect(moving.position[2]).toBe(0);
    expect(moving.velocity[2]).toBe(0);
  });

  it('壁の向きは動こうとした向きで決まる', () => {
    const left = solid(1, [-1.5, 0, 0], [0.5, 2, 2]);
    const moving = body([0, 0, 0], [-60, 0, 0]);
    stepBody(moving, [left], { mode: 'perspective3d', ...NO_GRAVITY });
    expect(moving.wallDirection).toBe(-1);
    expect(moving.position[0]).toBeCloseTo(-1 + 0.35, 6);
  });

  it('生成直後に壁の中に居ても押し出される（最大 4 回で打ち切る）', () => {
    const block = solid(1, [0, 0, 0], [1, 1, 1]);
    const moving = body([0.2, 0, 0], [0, 0, 0]);
    stepBody(moving, [block], { mode: 'perspective3d', ...NO_GRAVITY });
    expect(overlaps(aabbFromCenter(moving.position, moving.halfExtents), block.box, 'perspective3d')).toBe(false);
  });
});

describe('gameplay/physics と投影ルールの統合（§5.5 / §5.6）', () => {
  // Z が 5m 離れた 2 つの床。XY では隣り合っている（2D 専用の橋）
  const near = solid(1, [0, -1, 0], [1, 0.25, 1]);
  const far = solid(2, [2.2, -1, -5], [1, 0.25, 1]);

  it('2D では奥の床の上を歩ける。3D では同じ場所で落ちる', () => {
    const in2d = body([2.2, 0, 0]);
    stepBody(in2d, [near, far], { mode: 'ortho2d' });
    expect(in2d.grounded).toBe(true);

    const in3d = body([2.2, 0, 0]);
    stepBody(in3d, [near, far], { mode: 'perspective3d' });
    expect(in3d.grounded).toBe(false);
  });

  it('接地すると Z アンカーと安全座標が記録され、3D 復帰の吸着に繋がる（§5.5.3）', () => {
    const projection = createProjectionState('ortho2d');
    const moving = body([2.2, 0, 0]);
    stepBody(moving, [near, far], { mode: 'ortho2d', projection });

    expect(projection.anchor?.entity).toBe(far.entity);
    expect(projection.anchor?.zSpan).toEqual([-6, -4]);
    expect(projection.safePosition[0]).toBeCloseTo(2.2, 6);

    // この記録がそのまま 2D → 3D の位置解決に入る
    const resolution = resolveSwitchTo3D(moving.position, projection.anchor, moving.grounded, 350);
    expect(resolution.targetZ).toBe(-4);
  });

  it('上昇中はアンカーを捨てる（空中で切り替えたら素直に落ちる）', () => {
    const projection = createProjectionState('ortho2d');
    const moving = body([2.2, 0, 0]);
    stepBody(moving, [near, far], { mode: 'ortho2d', projection });
    expect(projection.anchor).not.toBeNull();

    moving.velocity[1] = 8;
    stepBody(moving, [near, far], { mode: 'ortho2d', projection });
    expect(projection.anchor).toBeNull();
  });
});

describe('gameplay/physics のワールド接続', () => {
  it('通り抜けるもの（トリガ）は当たり判定に入らない', () => {
    const world = createWorld();
    const wall = world.create();
    world.add(wall, StaticBody, { position: [2, 0, 0], halfExtents: [0.5, 2, 2], solid: true });
    const goal = world.create();
    world.add(goal, StaticBody, { position: [0, 0, 0], halfExtents: [0.5, 0.5, 0.5], solid: false });

    expect(solidsFor(world).map((s) => s.entity)).toEqual([wall]);
    expect(triggersFor(world).map((s) => s.entity)).toEqual([goal]);
  });

  it('システムとして回すと PlayerBody が落ちて床に乗る', () => {
    const world = createWorld();
    const floor = world.create();
    world.add(floor, StaticBody, { position: [0, -1, 0], halfExtents: [4, 0.25, 4], solid: true });

    const player = world.create();
    const playerBody: PlayerBodyData = world.add(player, PlayerBody);
    playerBody.position = [0, 3, 0];

    const system = physicsSystem(
      () => ({ mode: 'perspective3d' }),
      (w) => {
        const store = w.store(PlayerBody);
        const bodies: PlayerBodyData[] = [];
        store.each((_entity, value) => bodies.push(value));
        return bodies;
      },
    );

    for (let tick = 0; tick < 120; tick++) system(world, tick);

    expect(playerBody.grounded).toBe(true);
    expect(playerBody.position[1]).toBeCloseTo(-1 + 0.25 + 0.8, 6);
    expect(playerBody.velocity[1]).toBe(0);
    // 重力は世代によらず同じ値（能力の総量を揃える）
    expect(GRAVITY).toBeLessThan(0);
  });
});
