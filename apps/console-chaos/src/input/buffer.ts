/**
 * 入力バッファとコヨーテタイム（GAME_PLAN §10.4、IMPLEMENTATION_PLAN §5.6、T1-04）。
 *
 * **全世代で同じ値を使う。** 第1世代の 4 方向移動は「不便」であってよいが
 * 「不快」であってはならない、という方針の担保（GAME_PLAN §10.4）。
 * ここを世代ごとに変えると、制約の違いが操作精度の違いにすり替わってしまう。
 *
 * 物理ではなく入力の担当にしているのは、接地の解決（physics）と
 * 「押した意図をどれだけ覚えておくか」（input）を混ぜないため（§5.6）。
 *
 * 数え方は「最後に押した／最後に接地したのが何ティック前か」で持つ。
 * 残りフレーム数を減算する方式より、受付窓の境界を読み違えにくい。
 */

/** 押した入力を覚えておくフレーム数。押したティックを含む（GAME_PLAN §10.4） */
export const BUFFER_FRAMES = 8;

/** 地面を離れてからジャンプを受け付けるフレーム数（GAME_PLAN §10.4） */
export const COYOTE_FRAMES = 6;

/** 「一度も無い」を表す値。加算しても溢れない大きさにする */
const NEVER = Number.MAX_SAFE_INTEGER;

export interface ActionBuffer {
  /** 最後に押されてからのティック数 */
  framesSincePressed: number;
  /** 最後に接地してからのティック数 */
  framesSinceGrounded: number;
}

export function createActionBuffer(): ActionBuffer {
  return { framesSincePressed: NEVER, framesSinceGrounded: NEVER };
}

/**
 * 1 ティック分を進める。`pressed` はこのティックで押されたか、
 * `grounded` はこのティックで接地しているか。
 */
export function updateActionBuffer(buffer: ActionBuffer, pressed: boolean, grounded: boolean): void {
  buffer.framesSincePressed = pressed ? 0 : Math.min(buffer.framesSincePressed + 1, NEVER);
  buffer.framesSinceGrounded = grounded ? 0 : Math.min(buffer.framesSinceGrounded + 1, NEVER);
}

/**
 * 実行してよければ true を返し、バッファとコヨーテを消費する。
 * 消費するので、1 回の押下で 2 回跳ぶことはない。
 */
export function consumeActionBuffer(buffer: ActionBuffer): boolean {
  // 押下は「押したティックを含めて 8 ティック」、接地は「離れてから 6 ティック」まで
  if (buffer.framesSincePressed >= BUFFER_FRAMES) return false;
  if (buffer.framesSinceGrounded > COYOTE_FRAMES) return false;
  buffer.framesSincePressed = NEVER;
  buffer.framesSinceGrounded = NEVER;
  return true;
}

/** 空中へ出た瞬間に猶予を打ち切る（壁蹴りや踏み台の実装で使う） */
export function cancelCoyote(buffer: ActionBuffer): void {
  buffer.framesSinceGrounded = NEVER;
}

/**
 * 覚えている押下を捨てる。`consumeActionBuffer` を通さずに入力を使った側
 *（壁蹴りなど）が、同じ押下で二重に発動しないようにするために呼ぶ。
 */
export function clearActionBuffer(buffer: ActionBuffer): void {
  buffer.framesSincePressed = NEVER;
  buffer.framesSinceGrounded = NEVER;
}

/** 押下を覚えている最中か（消費はしない） */
export function isBuffered(buffer: ActionBuffer): boolean {
  return buffer.framesSincePressed < BUFFER_FRAMES;
}
