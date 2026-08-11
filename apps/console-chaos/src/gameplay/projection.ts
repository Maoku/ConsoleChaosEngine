/**
 * 投影ルール【本作の中核】（IMPLEMENTATION_PLAN §5.5、GAME_PLAN §5.2）。
 *
 * ここが破綻するとコンセプトが成立しない。テストファーストで実装し、
 * §5.5.4 の全ケースを `tests/unit/projection.test.ts` で固定している。
 *
 * 中心となる考え方（不変条件 I1 / I5）:
 *   世界の状態は**常に 3D で 1 つだけ**保持される。2D は投影であり、
 *   2D 用の状態を別に持たない。世代切替はシミュレーションの真実を変えず、
 *   変わるのは「衝突判定で Z を見るかどうか」だけである。
 */
import type { ProjectionMode } from '@/generation/profiles';
import type { Entity } from '@/core/ecs/world';

export type { ProjectionMode };

export type Vec3 = [number, number, number];

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export function aabbFromCenter(center: readonly number[], halfExtents: readonly number[]): AABB {
  const [cx = 0, cy = 0, cz = 0] = center;
  const [hx = 0, hy = 0, hz = 0] = halfExtents;
  return {
    min: [cx - hx, cy - hy, cz - hz],
    max: [cx + hx, cy + hy, cz + hz],
  };
}

/**
 * AABB の重なり判定。2D モードでは Z 軸を無視する
 *（＝ Z 方向に無限の柱として扱う）。
 *
 * **すべての重なり判定はこの関数を経由する。** 直接 AABB を比較するコードは
 * ESLint ルール chaos/no-raw-aabb-compare が禁止する（§5.6）。
 */
export function overlaps(a: AABB, b: AABB, mode: ProjectionMode): boolean {
  const xy =
    a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[1] < b.max[1] && a.max[1] > b.min[1];
  if (mode === 'ortho2d') return xy;
  return xy && a.min[2] < b.max[2] && a.max[2] > b.min[2];
}

// --- Z アンカー（2D → 3D の位置解決、§5.5.3） --------------------------------

/**
 * 2D モード中に接地していた面の Z 区間。
 * 3D へ戻るとき、プレイヤーをこの区間へ吸着させる。
 */
export interface GroundAnchor {
  entity: Entity;
  zSpan: [number, number];
}

export interface ProjectionState {
  mode: ProjectionMode;
  /** 直近に接地した面。空中では更新しない */
  anchor: GroundAnchor | null;
  /** めり込みから復帰するための直前の安全座標 */
  safePosition: Vec3;
}

export function createProjectionState(mode: ProjectionMode = 'perspective3d'): ProjectionState {
  return { mode, anchor: null, safePosition: [0, 0, 0] };
}

/** 接地判定が成立するたびに呼ぶ。2D 中の「どの床の上にいるか」を覚えておく */
export function recordGroundAnchor(state: ProjectionState, entity: Entity, zSpan: [number, number]): void {
  const [a, b] = zSpan;
  state.anchor = { entity, zSpan: a <= b ? [a, b] : [b, a] };
}

/** 接地していない間はアンカーを持たない（空中で切り替えたら素直に落下する） */
export function clearGroundAnchor(state: ProjectionState): void {
  state.anchor = null;
}

/**
 * 3D へ戻るときの目標 Z。変更不要なら null。
 *
 * - 接地していない → null（空中切替は Z を動かさない）
 * - アンカーが無い → null
 * - Z が区間内 → null
 * - それ以外 → 区間へクランプした値
 */
export function zTargetForSwitchTo3D(
  currentZ: number,
  anchor: GroundAnchor | null,
  grounded: boolean,
): number | null {
  if (!grounded || anchor === null) return null;
  const [low, high] = anchor.zSpan;
  if (currentZ >= low && currentZ <= high) return null;
  return Math.min(Math.max(currentZ, low), high);
}

export interface SwitchTo3DResolution {
  /** 目標 Z。null なら Z を動かさない */
  targetZ: number | null;
  /** 吸着にかける時間（トランジションの尺と一致させる） */
  durationMs: number;
  /** 進行度 0..1 における Z。演出として「見える」ように補間する */
  zAt(t: number): number;
}

/**
 * 2D → 3D の位置解決。トランジションの尺をかけて Z を吸着させることで、
 * 「奥行きが復活して吸い寄せられた」とプレイヤーが理解できるようにする（§5.5.3）。
 */
export function resolveSwitchTo3D(
  position: Vec3,
  anchor: GroundAnchor | null,
  grounded: boolean,
  durationMs: number,
): SwitchTo3DResolution {
  const startZ = position[2];
  const targetZ = zTargetForSwitchTo3D(startZ, anchor, grounded);
  return {
    targetZ,
    durationMs,
    zAt(t: number): number {
      if (targetZ === null) return startZ;
      const clamped = Math.min(Math.max(t, 0), 1);
      return startZ + (targetZ - startZ) * clamped;
    },
  };
}

// --- 3D → 2D の位置解決（めり込みの押し出し、§5.5.3） ------------------------

/** 押し出しの反復回数。これを超えたら方向別の脱出探索へ移る */
const MAX_PUSH_ITERATIONS = 4;

/**
 * 押し出しで動かしてよい最大距離（メートル）。
 * これを超える移動は「押し出し」ではなく瞬間移動になり、
 * プレイヤーが何が起きたか理解できない。その場合は安全座標へ復帰する方がよい。
 */
const MAX_PUSH_DISTANCE = 2.0;

export interface SwitchTo2DResolution {
  position: Vec3;
  /** 押し出し不能で安全座標へ復帰したか。切替中は無敵なのでダメージは出ない */
  usedSafePosition: boolean;
}

/** XY 平面で、重なりを解消する最小移動量を求める */
function minimumPushXY(body: AABB, solid: AABB): { axis: 0 | 1; amount: number } {
  // 各軸について、正負どちらへ抜けるのが近いかを見る
  const pushRight = solid.max[0] - body.min[0];
  const pushLeft = body.max[0] - solid.min[0];
  const pushUp = solid.max[1] - body.min[1];
  const pushDown = body.max[1] - solid.min[1];

  const x = pushRight < pushLeft ? pushRight : -pushLeft;
  const y = pushUp < pushDown ? pushUp : -pushDown;

  return Math.abs(x) <= Math.abs(y) ? { axis: 0, amount: x } : { axis: 1, amount: y };
}

/**
 * 3D → 2D（制約が緩む方向）の位置解決。
 *
 * Z を無視した結果、これまで衝突していなかったソリッドとめり込むことがある。
 * XY 平面上で最小移動量となる軸へ押し出し、押し出せなければ安全座標へ戻す。
 */
export function resolveSwitchTo2D(
  body: AABB,
  solids: readonly AABB[],
  safePosition: Vec3,
): SwitchTo2DResolution {
  const half: Vec3 = [
    (body.max[0] - body.min[0]) / 2,
    (body.max[1] - body.min[1]) / 2,
    (body.max[2] - body.min[2]) / 2,
  ];
  const position: Vec3 = [
    (body.min[0] + body.max[0]) / 2,
    (body.min[1] + body.max[1]) / 2,
    (body.min[2] + body.max[2]) / 2, // Z は保持する（不変条件 I1）
  ];

  for (let iteration = 0; iteration < MAX_PUSH_ITERATIONS; iteration++) {
    const current = aabbFromCenter(position, half);
    // 最も深くめり込んでいるものから順に解消する（決定的にするため深さで選ぶ）
    let worst: { push: { axis: 0 | 1; amount: number } } | null = null;
    let worstDepth = 0;
    for (const solid of solids) {
      if (!overlaps(current, solid, 'ortho2d')) continue;
      const push = minimumPushXY(current, solid);
      const depth = Math.abs(push.amount);
      if (worst === null || depth > worstDepth) {
        worst = { push };
        worstDepth = depth;
      }
    }
    if (worst === null) {
      return { position, usedSafePosition: false };
    }
    position[worst.push.axis] += worst.push.amount;
  }

  // 最小移動量の押し出しが振動して収束しない（狭い隙間に挟まれた）場合、
  // 4 方向それぞれについて「すべての重なりが解消するまでの距離」を求め、
  // 最も短いものを選ぶ。
  const start: Vec3 = [
    (body.min[0] + body.max[0]) / 2,
    (body.min[1] + body.max[1]) / 2,
    (body.min[2] + body.max[2]) / 2,
  ];
  let bestDistance = Infinity;
  let bestPosition: Vec3 | null = null;

  for (const axis of [0, 1] as const) {
    for (const direction of [1, -1] as const) {
      const probe: Vec3 = [...start];
      for (let step = 0; step < MAX_PUSH_ITERATIONS * 2; step++) {
        const current = aabbFromCenter(probe, half);
        let needed = 0;
        for (const solid of solids) {
          if (!overlaps(current, solid, 'ortho2d')) continue;
          const distance =
            direction > 0 ? solid.max[axis] - current.min[axis] : current.max[axis] - solid.min[axis];
          needed = Math.max(needed, distance);
        }
        if (needed === 0) break;
        probe[axis] += direction * needed;
      }
      const travelled = Math.abs(probe[axis] - start[axis]);
      const resolved = solids.every((solid) => !overlaps(aabbFromCenter(probe, half), solid, 'ortho2d'));
      if (resolved && travelled <= MAX_PUSH_DISTANCE && travelled < bestDistance) {
        bestDistance = travelled;
        bestPosition = probe;
      }
    }
  }

  if (bestPosition) {
    return { position: bestPosition, usedSafePosition: false };
  }

  // 四方が埋まっている：直前の安全座標へ復帰する。
  // 切替中は無敵なのでダメージは発生しない（GAME_PLAN §5.1）
  return { position: [...safePosition] as Vec3, usedSafePosition: true };
}

/**
 * 2D モードではプレイヤーの Z 速度を 0 に固定する（§5.5.1）。
 * 速度の配列を直接受け取り、モードに応じて Z 成分だけを潰す。
 */
export function constrainVelocity(velocity: Vec3, mode: ProjectionMode): Vec3 {
  if (mode === 'ortho2d') velocity[2] = 0;
  return velocity;
}
