/**
 * キーボード入力ソース（GAME_PLAN §10.1、T1-04）。
 *
 * **キーボードだけで最後までクリアできることを保証する**（GAME_PLAN §10.2）。
 * アナログと感圧はキーボードに無いので、`Shift` 併用の 2 段階速度と
 * 押下時間による代替をここで生の値として作る（実際の解釈は constraints.ts と mapper.ts）。
 *
 * キー割り当て（§10.1）:
 *   移動 … WASD / 方向キー     ジャンプ … Space
 *   アクション … J             サブアクション … K
 *   感圧（長押し）… L          歩き … Shift
 *   世代切替 … 1〜4            巡回 … Q / E
 *
 * DOM に触るのは `attach()` の中だけで、状態はキー名の集合として持つ。
 * これによりヘッドレスのテストからも `press` / `release` で駆動できる。
 */
import { createRawInput, generationForSlot, type InputSource, type RawInput } from './mapper';

/** 押されている間 -1 / +1 を与えるキー。左右と奥行きの 2 軸（奥が負） */
const MOVE_KEYS: Record<string, { axis: 0 | 1; value: -1 | 1 }> = {
  arrowleft: { axis: 0, value: -1 },
  a: { axis: 0, value: -1 },
  arrowright: { axis: 0, value: 1 },
  d: { axis: 0, value: 1 },
  arrowup: { axis: 1, value: -1 },
  w: { axis: 1, value: -1 },
  arrowdown: { axis: 1, value: 1 },
  s: { axis: 1, value: 1 },
};

/** 毎ティック走査する形。`Object.entries` をフレームごとに作らないため */
const MOVE_ENTRIES = Object.entries(MOVE_KEYS);

const BUTTON_KEYS = {
  jump: [' ', 'space'],
  action: ['j'],
  subAction: ['k'],
  pressure: ['l'],
} as const;

/** 世代の直接指定（`1`〜`4`）。並び順が世代の並び順に対応する */
const SLOT_KEYS = ['1', '2', '3', '4'] as const;

/** 隣接世代への巡回 */
const CYCLE_KEYS: Record<string, -1 | 1> = { q: -1, e: 1 };

export interface KeyboardSource extends InputSource {
  /** キーボードは常に読める（未接続という状態を持たない） */
  read(): RawInput;
  /** テストと将来のキーコンフィグから直接叩ける入口 */
  press(key: string): void;
  release(key: string): void;
  /** フォーカスを失ったときなど、押しっぱなしを解消する */
  releaseAll(): void;
  /** 実ブラウザへ接続する。戻り値を呼ぶと解除される */
  attach(target: EventTarget): () => void;
}

/** `e.key` の表記ゆれ（大文字・Shift 併用）を吸収する */
function normalize(key: string): string {
  return key.toLowerCase();
}

export function createKeyboardSource(): KeyboardSource {
  const held = new Set<string>();
  /** 直近に押された移動軸（4 方向化の優先。GAME_PLAN §10.4） */
  let lastAxis: 0 | 1 | null = null;
  /** 押された瞬間だけ立てる。read() で消費する（押しっぱなしで連続切替しない） */
  let pendingSlot: number | null = null;
  let pendingCycle: -1 | 0 | 1 = 0;

  function anyHeld(keys: readonly string[]): boolean {
    return keys.some((key) => held.has(key));
  }

  function press(rawKey: string): void {
    const key = normalize(rawKey);
    if (held.has(key)) return; // キーリピートは押下として扱わない
    held.add(key);

    const move = MOVE_KEYS[key];
    if (move) lastAxis = move.axis;

    const slot = SLOT_KEYS.indexOf(key as (typeof SLOT_KEYS)[number]);
    if (slot >= 0) pendingSlot = slot;

    const cycle = CYCLE_KEYS[key];
    if (cycle) pendingCycle = cycle;
  }

  function release(rawKey: string): void {
    held.delete(normalize(rawKey));
  }

  return {
    press,
    release,
    releaseAll(): void {
      held.clear();
    },
    read(): RawInput {
      const raw = createRawInput();
      for (const [key, { axis, value }] of MOVE_ENTRIES) {
        if (held.has(key)) raw.move[axis] += value;
      }
      // 左右同時押しは相殺されて 0（意図しない片方向への走り出しを防ぐ）
      raw.move[0] = Math.max(-1, Math.min(1, raw.move[0]));
      raw.move[1] = Math.max(-1, Math.min(1, raw.move[1]));

      raw.jump = anyHeld(BUTTON_KEYS.jump);
      raw.action = anyHeld(BUTTON_KEYS.action);
      raw.subAction = anyHeld(BUTTON_KEYS.subAction);
      raw.pressureButton = anyHeld(BUTTON_KEYS.pressure);
      raw.fine = held.has('shift');
      raw.lastAxis = lastAxis;

      raw.switchTo = pendingSlot === null ? null : generationForSlot(pendingSlot);
      raw.switchCycle = pendingCycle;
      pendingSlot = null;
      pendingCycle = 0;
      return raw;
    },
    attach(target): () => void {
      const down = (event: Event): void => {
        const key = (event as KeyboardEvent).key;
        if (typeof key === 'string') press(key);
      };
      const up = (event: Event): void => {
        const key = (event as KeyboardEvent).key;
        if (typeof key === 'string') release(key);
      };
      const blur = (): void => held.clear();
      target.addEventListener('keydown', down);
      target.addEventListener('keyup', up);
      target.addEventListener('blur', blur);
      return () => {
        target.removeEventListener('keydown', down);
        target.removeEventListener('keyup', up);
        target.removeEventListener('blur', blur);
      };
    },
  };
}
