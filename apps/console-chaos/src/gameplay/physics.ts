/**
 * 衝突（IMPLEMENTATION_PLAN §5.6、T1-06）。
 *
 * AABB + スイープ（連続衝突判定）。**高速移動でトンネリングしない**ことが受け入れ条件。
 * 1 ティックの移動量が薄い床を跨いでも、掃過形状（移動前後を包む AABB）で判定するため
 * 素通りしない。
 *
 * 解決は軸分離。X → Y →（3D のみ）Z の順で、1 ティックあたり最大 4 回の反復（§5.6）。
 *
 * **すべての重なり判定は `projection.overlaps` を経由する。**
 * したがって 2D 投影の世代では Z が無視され、奥行きの違う足場が「同じ場所」になる。
 * 投影ルールの効果は物理側に一切書かれておらず、`overlaps` に集約されている
 *（不変条件 I1 / I5。ESLint ルール chaos/no-raw-aabb-compare が直接比較を禁止する）。
 *
 * ブロードフェーズ（XY 平面の一様グリッド、§5.5.1）はまだ入れていない。
 * エリア 1 規模では総当たりで足り、必要になった時点で `solidsFor` の中だけが変わる。
 */
import { TICK_SECONDS, defineComponent, query1, type Entity, type System, type World } from '@console-chaos/engine';
import {
  aabbFromCenter,
  clearGroundAnchor,
  constrainVelocity,
  overlaps,
  recordGroundAnchor,
  type AABB,
  type ProjectionMode,
  type ProjectionState,
  type Vec3,
} from './projection';

/** 重力加速度（m/s²）。世代によらず同じ（能力の総量を揃えるため。GAME_PLAN §5.3） */
export const GRAVITY = -22;

/** 終端速度（m/s）。1 ティックの移動量に上限を与え、掃過の範囲も抑える */
export const MAX_FALL_SPEED = 30;

/** 1 ティックあたりのめり込み解消の反復上限（§5.6） */
export const MAX_RESOLVE_ITERATIONS = 4;

/** 動く物体。プレイヤー（`PlayerBody`）はこの形を満たす */
export interface MovingBody {
  position: Vec3;
  velocity: Vec3;
  halfExtents: Vec3;
  /** 物理が毎ティック書く */
  grounded: boolean;
  /** 触れている壁の向き（-1 = 左に壁 / 1 = 右に壁 / 0 = 無し） */
  wallDirection: -1 | 0 | 1;
}

export interface StaticBodyData {
  position: Vec3;
  halfExtents: Vec3;
  /** false なら通り抜ける（ゴール・トリガ領域）。判定だけしたいものに使う */
  solid: boolean;
}

export const StaticBody = defineComponent<StaticBodyData>('StaticBody', () => ({
  position: [0, 0, 0],
  halfExtents: [0.5, 0.5, 0.5],
  solid: true,
}));

/** 衝突相手。どのエンティティに当たったかは Z アンカーの記録に要る（§5.5.3） */
export interface SolidHit {
  entity: Entity;
  box: AABB;
}

export interface StepOptions {
  mode: ProjectionMode;
  dtSeconds?: number;
  gravity?: number;
  /** 渡すと Z アンカーと安全座標を更新する（§5.5.3 の入力になる） */
  projection?: ProjectionState;
}

export interface StepResult {
  grounded: boolean;
  wallDirection: -1 | 0 | 1;
  /** 接地した相手。空中なら null */
  groundHit: SolidHit | null;
}

/** 移動前後を包む掃過形状。これで判定するからトンネリングしない */
function sweptBox(box: AABB, axis: 0 | 1 | 2, amount: number): AABB {
  const swept: AABB = { min: [...box.min] as Vec3, max: [...box.max] as Vec3 };
  if (amount > 0) swept.max[axis] += amount;
  else swept.min[axis] += amount;
  return swept;
}

/**
 * 1 軸だけ動かす。動ける距離まで進み、当たった相手を返す。
 *
 * 距離の計算に使うのは引き算だけで、境界どうしの大小比較はしない
 *（重なりの判断は `overlaps` に任せる。§5.6）。
 */
function moveAxis(
  body: MovingBody,
  axis: 0 | 1 | 2,
  amount: number,
  solids: readonly SolidHit[],
  mode: ProjectionMode,
): SolidHit | null {
  if (amount === 0) return null;

  const box = aabbFromCenter(body.position, body.halfExtents);
  const swept = sweptBox(box, axis, amount);
  const direction = amount > 0 ? 1 : -1;

  let allowed = Math.abs(amount);
  let hit: SolidHit | null = null;

  for (const solid of solids) {
    if (!overlaps(swept, solid.box, mode)) continue;
    // 進行方向にある隙間。すでにめり込んでいれば 0（この軸ではもう進めない）
    const gap = direction > 0 ? solid.box.min[axis] - box.max[axis] : box.min[axis] - solid.box.max[axis];
    const clamped = Math.max(gap, 0);
    if (clamped < allowed) {
      allowed = clamped;
      hit = solid;
    }
  }

  body.position[axis] += direction * allowed;
  if (hit) body.velocity[axis] = 0;
  return hit;
}

/** その軸で重なりを解消するのに必要な最小の押し出し量（正負つき） */
function pushOutAmount(box: AABB, solid: AABB, axis: 0 | 1 | 2): number {
  const toPositive = solid.max[axis] - box.min[axis];
  const toNegative = box.max[axis] - solid.min[axis];
  return toPositive < toNegative ? toPositive : -toNegative;
}

/**
 * めり込みを解消する。生成直後に壁の中に居た場合や、
 * 軸分離では取り切れなかった角の接触に効く。最大 4 回で打ち切る（§5.6）。
 */
function resolveOverlaps(body: MovingBody, solids: readonly SolidHit[], mode: ProjectionMode): void {
  const axes: readonly (0 | 1 | 2)[] = mode === 'ortho2d' ? [0, 1] : [0, 1, 2];

  for (let iteration = 0; iteration < MAX_RESOLVE_ITERATIONS; iteration++) {
    const box = aabbFromCenter(body.position, body.halfExtents);
    let worst: { axis: 0 | 1 | 2; amount: number } | null = null;

    for (const solid of solids) {
      if (!overlaps(box, solid.box, mode)) continue;
      // 各軸のうち、最も少ない移動で抜けられる方向を選ぶ
      let best: { axis: 0 | 1 | 2; amount: number } | null = null;
      for (const axis of axes) {
        const amount = pushOutAmount(box, solid.box, axis);
        if (best === null || Math.abs(amount) < Math.abs(best.amount)) best = { axis, amount };
      }
      if (best && (worst === null || Math.abs(best.amount) > Math.abs(worst.amount))) worst = best;
    }

    if (worst === null) return;
    body.position[worst.axis] += worst.amount;
    body.velocity[worst.axis] = 0;
  }
}

/**
 * 1 体分の 1 ティック。重力 → 軸分離の移動 → めり込み解消の順。
 *
 * 呼ぶ側（システム）が世代の投影モードを渡す。物理は世代を知らない（不変条件 I2）。
 */
export function stepBody(body: MovingBody, solids: readonly SolidHit[], options: StepOptions): StepResult {
  const dt = options.dtSeconds ?? TICK_SECONDS;
  const gravity = options.gravity ?? GRAVITY;
  const mode = options.mode;

  body.velocity[1] = Math.max(body.velocity[1] + gravity * dt, -MAX_FALL_SPEED);
  // 2D 投影の世代では Z 方向へ動かない（§5.5.1）
  constrainVelocity(body.velocity, mode);

  body.grounded = false;
  body.wallDirection = 0;
  let groundHit: SolidHit | null = null;

  // §5.6 の順序：X → Y →（3D のみ）Z
  // 壁の向きは「動こうとした向き」で決める。moveAxis は当たると速度を 0 にするため先に取る
  const horizontalAmount = body.velocity[0] * dt;
  const wallHit = moveAxis(body, 0, horizontalAmount, solids, mode);
  if (wallHit) body.wallDirection = horizontalAmount > 0 ? 1 : -1;

  const verticalAmount = body.velocity[1] * dt;
  const floorHit = moveAxis(body, 1, verticalAmount, solids, mode);
  if (floorHit && verticalAmount < 0) {
    body.grounded = true;
    groundHit = floorHit;
  }

  if (mode === 'perspective3d') moveAxis(body, 2, body.velocity[2] * dt, solids, mode);

  resolveOverlaps(body, solids, mode);

  if (options.projection) {
    if (body.grounded && groundHit) {
      // 2D 中に「どの床の上に居たか」を覚えておく。3D 復帰時の Z 吸着に使う（§5.5.3）
      recordGroundAnchor(options.projection, groundHit.entity, [groundHit.box.min[2], groundHit.box.max[2]]);
      options.projection.safePosition = [...body.position] as Vec3;
    } else if (body.velocity[1] > 0) {
      // 上昇中は接地面から離れている（空中で切り替えたら素直に落ちる）
      clearGroundAnchor(options.projection);
    }
  }

  return { grounded: body.grounded, wallDirection: body.wallDirection, groundHit };
}

/** ワールドの静的な当たり判定を集める。ブロードフェーズを入れるならここだけが変わる */
export function solidsFor(world: World): SolidHit[] {
  const out: SolidHit[] = [];
  query1(world, StaticBody, (entity, value) => {
    if (!value.solid) return;
    out.push({ entity, box: aabbFromCenter(value.position, value.halfExtents) });
  });
  return out;
}

/** 通り抜けるもの（ゴール・トリガ）。判定だけしたい側が使う */
export function triggersFor(world: World): SolidHit[] {
  const out: SolidHit[] = [];
  query1(world, StaticBody, (entity, value) => {
    if (value.solid) return;
    out.push({ entity, box: aabbFromCenter(value.position, value.halfExtents) });
  });
  return out;
}

export interface PhysicsFrame {
  mode: ProjectionMode;
  projection?: ProjectionState;
}

/**
 * §4.4 の段階 5（物理積分 + 衝突解決）に差し込むシステムを作る。
 * 動かす対象は呼ぶ側が指定する（プレイヤーは `PlayerBody`、敵は T2 以降）。
 */
export function physicsSystem(
  frame: () => PhysicsFrame,
  bodiesOf: (world: World) => readonly MovingBody[],
): System {
  return (world) => {
    const { mode, projection } = frame();
    const solids = solidsFor(world);
    for (const body of bodiesOf(world)) {
      stepBody(body, solids, projection ? { mode, projection } : { mode });
    }
  };
}
