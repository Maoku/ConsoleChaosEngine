/**
 * ゲームパッド入力ソース（GAME_PLAN §10.2、T1-04）。
 *
 * **ゲームパッドは必須にしない。** 接続されているときだけ、
 * アナログ・感圧・振動を本来の形で使う（振動は T1-05 以降の担当）。
 * 未接続なら `read()` は null を返し、キーボードだけで成立する。
 *
 * ボタン配置は Gamepad API の標準配置（standard mapping）の番号で書く。
 * 実機の商品名やボタン刻印は使わない（GAME_PLAN §7.1.1）。
 */
import { createRawInput, type InputSource, type RawInput } from './mapper';

/** これ未満の倒し込みは 0 と見なす（スティックの中立ずれの吸収） */
export const STICK_DEADZONE = 0.25;

/** 標準配置のボタン番号。左列が本作の機能 */
const BUTTON = {
  jump: 0, // 下段のフェイスボタン
  action: 2, // 左のフェイスボタン
  subAction: 3, // 上段のフェイスボタン
  cyclePrev: 4, // 左上のショルダー（GAME_PLAN §5.1 の L）
  cycleNext: 5, // 右上のショルダー（同 R）
  pressure: 7, // 右下のトリガー（アナログ値をそのまま感圧に使う）
} as const;

const AXIS = { x: 0, depth: 1 } as const;

/** 方向パッド（標準配置） */
const DPAD = { up: 12, down: 13, left: 14, right: 15 } as const;

/** 実行時に触るのはこれだけ。テストから差し替えられるよう最小限の形で持つ */
export interface GamepadLike {
  connected: boolean;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export type GamepadReader = () => readonly (GamepadLike | null)[];

function defaultReader(): readonly (GamepadLike | null)[] {
  const nav = globalThis.navigator as Navigator | undefined;
  if (!nav?.getGamepads) return [];
  return nav.getGamepads() as readonly (GamepadLike | null)[];
}

function applyDeadzone(value: number): number {
  if (Math.abs(value) < STICK_DEADZONE) return 0;
  // しきい値の外側を 0..1 へ引き伸ばす（境界での飛びを無くす）
  const sign = value < 0 ? -1 : 1;
  return sign * Math.min((Math.abs(value) - STICK_DEADZONE) / (1 - STICK_DEADZONE), 1);
}

function isPressed(pad: GamepadLike, index: number): boolean {
  return pad.buttons[index]?.pressed ?? false;
}

function valueOf(pad: GamepadLike, index: number): number {
  return pad.buttons[index]?.value ?? 0;
}

export interface GamepadSource extends InputSource {
  /** 接続中のパッドがあるか（UI の表示切替に使う） */
  connected(): boolean;
}

export function createGamepadSource(reader: GamepadReader = defaultReader): GamepadSource {
  // 押しっぱなしで巡回し続けないよう、前ティックの押下を覚えておく
  let prevPrev = false;
  let prevNext = false;

  function firstConnected(): GamepadLike | null {
    for (const pad of reader()) {
      if (pad?.connected) return pad;
    }
    return null;
  }

  return {
    connected: () => firstConnected() !== null,
    read(): RawInput | null {
      const pad = firstConnected();
      if (!pad) {
        prevPrev = false;
        prevNext = false;
        return null;
      }

      const raw = createRawInput();
      raw.move[0] = applyDeadzone(pad.axes[AXIS.x] ?? 0);
      raw.move[1] = applyDeadzone(pad.axes[AXIS.depth] ?? 0);

      // 方向パッドはアナログの上書きではなく合成にする（同時に触っても破綻しない）
      if (isPressed(pad, DPAD.left)) raw.move[0] -= 1;
      if (isPressed(pad, DPAD.right)) raw.move[0] += 1;
      if (isPressed(pad, DPAD.up)) raw.move[1] -= 1;
      if (isPressed(pad, DPAD.down)) raw.move[1] += 1;
      raw.move[0] = Math.max(-1, Math.min(1, raw.move[0]));
      raw.move[1] = Math.max(-1, Math.min(1, raw.move[1]));

      raw.jump = isPressed(pad, BUTTON.jump);
      raw.action = isPressed(pad, BUTTON.action);
      raw.subAction = isPressed(pad, BUTTON.subAction);
      // 感圧はトリガーの実値。押下時間の代替は要らない（GAME_PLAN §10.2）
      raw.pressureAnalog = Math.max(0, Math.min(valueOf(pad, BUTTON.pressure), 1));

      const prev = isPressed(pad, BUTTON.cyclePrev);
      const next = isPressed(pad, BUTTON.cycleNext);
      raw.switchCycle = prev && !prevPrev ? -1 : next && !prevNext ? 1 : 0;
      prevPrev = prev;
      prevNext = next;

      // 世代の直接指定はゲームパッドに割り当てない（L / R の巡回のみ。GAME_PLAN §5.1）
      raw.switchTo = null;
      // スティックは押し順を持たない。4 方向化は倒し込みの大きい軸で決まる
      raw.lastAxis = null;
      return raw;
    },
  };
}
