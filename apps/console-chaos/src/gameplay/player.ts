/**
 * プレイヤーの基本アクション（GAME_PLAN §5.3、T1-05）。
 *
 * 移動・ジャンプ・攻撃・微調整の**すべての世代差を `ActionProfile` の値から導く**。
 * 世代 ID の分岐は 1 つも無い（不変条件 I2。ESLint が検査する）。
 *
 * **能力の総量はどの世代でも等価にする**（GAME_PLAN §5.3）。
 * 第1世代は移動が粗い代わりに `moveSnap` で「狙った場所にぴたりと止まれる」。
 * 第3世代以降は自由に狙える代わりに、止まる位置は自分で合わせる必要がある。
 *
 * 担当の切れ目:
 * - ここが書くのは**速度と意図**（跳ぶ、攻撃が出ている）まで。
 *   位置の積分と衝突解決は物理（T1-06）が行う
 * - `grounded` / `wallDirection` は物理が毎ティック書き、ここは読むだけ
 * - 入力バッファとコヨーテタイムは `input/buffer.ts` の共通実装を使う（全世代同じ）
 */
import { defineComponent } from '@/core/ecs/component';
import { query1, query2 } from '@/core/ecs/query';
import type { System } from '@/core/ecs/system';
import type { Entity, World } from '@/core/ecs/world';
import type { ForwardXZ, GenerationProfile } from '@/generation/profiles';
import {
  clearActionBuffer,
  consumeActionBuffer,
  createActionBuffer,
  isBuffered,
  updateActionBuffer,
  type ActionBuffer,
} from '@/input/buffer';
import type { InputSnapshot } from '@/input/mapper';
import { aabbFromCenter, constrainVelocity, type AABB, type Vec3 } from './projection';

/** ジャンプの初速（m/s）。全世代で同じ高さから始め、可変ジャンプだけが途中で切る */
export const JUMP_SPEED = 8.2;

/** 可変ジャンプでボタンを離したときの残り上昇速度の割合 */
export const VARIABLE_JUMP_CUT = 0.45;

/** 壁蹴りで壁から離れる速度（m/s） */
export const WALL_JUMP_PUSH = 5.5;

/** 攻撃判定が出ているティック数 */
export const ATTACK_TICKS = 8;

/** 次に攻撃できるまでのティック数 */
export const ATTACK_COOLDOWN_TICKS = 12;

/** 攻撃の基本の間合い（メートル） */
export const ATTACK_REACH = 1.1;

/** 溜め切ったときに伸びる間合い（メートル） */
export const ATTACK_CHARGE_BONUS = 0.8;

/** 溜め切るまでの時間（ミリ秒） */
export const CHARGE_FULL_MS = 600;

/** ロックオンが成立する距離（メートル） */
export const LOCK_ON_RANGE = 6;

/** XZ 平面上の向き（正規化済み）。Y は攻撃の向きに使わない */
export type AimXZ = [number, number];

export interface PlayerBodyData {
  position: Vec3;
  velocity: Vec3;
  halfExtents: Vec3;
  /** 物理（T1-06）が毎ティック書く。ここは読むだけ */
  grounded: boolean;
  /** 触れている壁の向き（-1 = 左に壁 / 1 = 右に壁 / 0 = 無し）。物理が書く */
  wallDirection: -1 | 0 | 1;
}

export interface PlayerStateData {
  /** 左右の向き。攻撃が正面のみの世代ではこれが攻撃方向になる */
  facing: -1 | 1;
  /** 攻撃の向き（XZ 平面）。全方位の世代でのみ左右以外を向く */
  aim: AimXZ;
  jump: ActionBuffer;
  /** 攻撃判定が出ている残りティック */
  attackTicks: number;
  attackCooldown: number;
  /** 攻撃の強さ 0..1。溜め（第2世代）と感圧（第4世代）が入る */
  attackPower: number;
  /** 溜めの経過（ミリ秒）。溜めを持たない世代では常に 0 */
  chargeMs: number;
  /** ロックオン中の相手。ロックオンを持たない世代では常に null */
  lockOn: Entity | null;
}

export const PlayerBody = defineComponent<PlayerBodyData>('PlayerBody', () => ({
  position: [0, 0, 0],
  velocity: [0, 0, 0],
  halfExtents: [0.35, 0.8, 0.35],
  grounded: false,
  wallDirection: 0,
}));

export const PlayerState = defineComponent<PlayerStateData>('PlayerState', () => ({
  facing: 1,
  aim: [1, 0],
  jump: createActionBuffer(),
  attackTicks: 0,
  attackCooldown: 0,
  attackPower: 0,
  chargeMs: 0,
  lockOn: null,
}));

/** ロックオンの対象。敵は T2 以降だが、成立条件をここで固定しておく */
export const LockTarget = defineComponent<{ position: Vec3 }>('LockTarget');

/** このティックの入力と世代。システムの外から与える（§4.4 の段階 3 の結果） */
export interface PlayerFrame {
  snapshot: InputSnapshot;
  profile: GenerationProfile;
}

/**
 * 入力の 2 軸を、カメラを基底にしたワールドの XZ へ直す（T2-08）。
 *
 * **「奥へ倒したら画面の奥へ進む」を全世代で成り立たせる。**
 * 入力の `move[1]` は奥が負（`input/source_keyboard.ts`）で、
 * カメラの `forward` は視線の水平成分。右手は forward × up = `(-fz, fx)`。
 *
 * 真横から見る世代では forward が `(0,-1)` なので結果は `(move[0], move[1])` と
 * 一致する（改訂前の実装そのもの）。背後視点の世代だけが 90° 回った基底になる。
 */
export function moveToWorldXZ(move: readonly [number, number], forward: ForwardXZ): AimXZ {
  const [fx, fz] = forward;
  return [move[0] * -fz - move[1] * fx, move[0] * fx - move[1] * fz];
}

function normalizeXZ(x: number, z: number, fallback: AimXZ): AimXZ {
  const length = Math.hypot(x, z);
  if (length < 1e-6) return fallback;
  return [x / length, z / length];
}

/** グリッドへ吸着させる（第1世代の「1 マス単位で正確に止まれる」） */
function snapTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * ロックオン対象を選ぶ。決定的にするため、同距離ならエンティティ番号の小さい方。
 * 走査順は query1 がエンティティ番号順に固定している（不変条件 I4）。
 */
function nearestTarget(world: World, from: Vec3): { entity: Entity; position: Vec3 } | null {
  let best: { entity: Entity; position: Vec3 } | null = null;
  let bestDistance = LOCK_ON_RANGE;
  query1(world, LockTarget, (entity, target) => {
    const distance = Math.hypot(target.position[0] - from[0], target.position[2] - from[2]);
    if (distance <= bestDistance && (best === null || distance < bestDistance)) {
      best = { entity, position: target.position };
      bestDistance = distance;
    }
  });
  return best;
}

function updateAim(
  world: World,
  body: PlayerBodyData,
  state: PlayerStateData,
  moveXZ: AimXZ,
  profile: GenerationProfile,
): void {
  const forward: AimXZ = [state.facing, 0];

  // 全方位を持たない世代は、常に正面（左右）しか狙えない
  if (!profile.action.attack.startsWith('omni')) {
    state.aim = forward;
    state.lockOn = null;
    return;
  }

  // ロックオンを持つ世代は、射程内の相手がいればそちらを向く
  if (profile.action.attack === 'omni_lock') {
    const target = nearestTarget(world, body.position);
    if (target) {
      state.lockOn = target.entity;
      state.aim = normalizeXZ(
        target.position[0] - body.position[0],
        target.position[2] - body.position[2],
        forward,
      );
      return;
    }
  }

  state.lockOn = null;
  // 入力を倒している方向へ。倒していなければ正面。
  // 狙いも移動と同じカメラ相対の向きを使う（画面の奥へ倒したら奥を狙う）
  state.aim = normalizeXZ(moveXZ[0], moveXZ[1], forward);
}

function updateAttack(state: PlayerStateData, snapshot: InputSnapshot, profile: GenerationProfile): void {
  if (state.attackCooldown > 0) state.attackCooldown--;
  if (state.attackTicks > 0) state.attackTicks--;

  const fire = (power: number): void => {
    state.attackTicks = ATTACK_TICKS;
    state.attackCooldown = ATTACK_COOLDOWN_TICKS;
    state.attackPower = Math.min(Math.max(power, 0), 1);
    state.chargeMs = 0;
  };

  // 溜めを持つ世代：押している間ためて、離した瞬間に出る
  if (profile.action.attack === 'forward_charge') {
    if (snapshot.action.down) {
      state.chargeMs = Math.min(snapshot.action.heldMs, CHARGE_FULL_MS);
      return;
    }
    if (snapshot.action.released && state.attackCooldown === 0) fire(state.chargeMs / CHARGE_FULL_MS);
    else if (snapshot.action.released) state.chargeMs = 0;
    return;
  }

  state.chargeMs = 0;
  if (!snapshot.action.pressed || state.attackCooldown > 0) return;
  // 感圧を持つ世代は押し込み量が強さになる。持たない世代は常に基本の強さ
  fire(profile.input.pressureSensitive ? snapshot.pressure : 0);
}

function updateJump(body: PlayerBodyData, state: PlayerStateData, snapshot: InputSnapshot, profile: GenerationProfile): void {
  updateActionBuffer(state.jump, snapshot.jump.pressed, body.grounded);

  if (consumeActionBuffer(state.jump)) {
    body.velocity[1] = JUMP_SPEED;
  } else if (
    profile.action.wallJump &&
    !body.grounded &&
    body.wallDirection !== 0 &&
    isBuffered(state.jump)
  ) {
    // 壁蹴り：壁と反対へ押し出しつつ跳ぶ。向きも反転する
    body.velocity[1] = JUMP_SPEED;
    body.velocity[0] = -body.wallDirection * WALL_JUMP_PUSH;
    state.facing = body.wallDirection > 0 ? -1 : 1;
    // 消費を通さずに使ったので、同じ押下で二重に跳ばないよう自分で捨てる
    clearActionBuffer(state.jump);
  }

  // 高さ可変：上昇中に離したら切る。固定高さの世代は離しても伸び切る
  if (profile.action.variableJump && snapshot.jump.released && body.velocity[1] > 0) {
    body.velocity[1] *= VARIABLE_JUMP_CUT;
  }
}

/** 1 体分の更新。テストから直接呼べるよう、システムとは別に公開する */
export function updatePlayer(
  world: World,
  body: PlayerBodyData,
  state: PlayerStateData,
  frame: PlayerFrame,
): void {
  const { snapshot, profile } = frame;

  // --- 移動。入力はカメラ相対に読み替える（T2-08）。
  //     アナログの世代では倒し込みがそのまま速度になる（微調整） ---
  const move = moveToWorldXZ(snapshot.move, profile.camera.forward);
  body.velocity[0] = move[0] * profile.action.moveSpeed;
  body.velocity[2] = move[1] * profile.action.moveSpeed;
  // 2D 投影の世代では Z 方向へ動けない（§5.5.1）。判定は投影ルールに委ねる
  constrainVelocity(body.velocity, profile.video.projection);

  // 向きは**進んだ向き**から決める。入力の左右ではないので、背後視点で
  // 真横へ流しているあいだは向きが変わらない（カメラも暴れない）
  if (move[0] !== 0) state.facing = move[0] > 0 ? 1 : -1;

  // --- グリッド吸着。手を離した瞬間に「ぴたりと止まれる」（GAME_PLAN §5.3 / §10.4） ---
  const snap = profile.action.moveSnap;
  if (snap > 0 && body.grounded) {
    if (move[0] === 0) body.position[0] = snapTo(body.position[0], snap);
    if (move[1] === 0) body.position[2] = snapTo(body.position[2], snap);
  }

  updateJump(body, state, snapshot, profile);
  updateAim(world, body, state, move, profile);
  updateAttack(state, snapshot, profile);
}

/**
 * 攻撃の当たり判定。出ていなければ null。
 *
 * **重なり判定そのものは `projection.overlaps` を通す**（§5.6）。
 * 2D の世代では Z が無視されるため、奥行きの違う 2 つのスイッチに同時に当たる
 *（GAME_PLAN §5.2「物体の重ね合わせ」がここで自然に成立する）。
 */
export function attackBox(body: PlayerBodyData, state: PlayerStateData): AABB | null {
  if (state.attackTicks <= 0) return null;
  const reach = ATTACK_REACH + state.attackPower * ATTACK_CHARGE_BONUS;
  const distance = body.halfExtents[0] + reach / 2;
  return aabbFromCenter(
    [
      body.position[0] + state.aim[0] * distance,
      body.position[1],
      body.position[2] + state.aim[1] * distance,
    ],
    [reach / 2, body.halfExtents[1] * 0.8, reach / 2],
  );
}

/** §4.4 の段階 4（ゲームプレイ）に差し込むシステム */
export function playerSystem(frame: () => PlayerFrame): System {
  return (world) => {
    const current = frame();
    query2(world, PlayerBody, PlayerState, (_entity, body, state) => {
      updatePlayer(world, body, state, current);
    });
  };
}
