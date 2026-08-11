/**
 * 抽象入力（IMPLEMENTATION_PLAN §5.7、GAME_PLAN §10、T1-04）。
 *
 * **ゲームロジックが見るのは `InputSnapshot` だけ。** 入力ソース（キーボード /
 * ゲームパッド / 将来のタッチ）は `RawInput` を返すだけで、ここが唯一の変換点になる。
 * これにより入力ソースの追加がゲームロジックへ波及しない（GAME_PLAN §10.3）。
 *
 * 軸の約束（世界は常に 3D。§5.5）:
 *   move[0] … 左右（ワールド X）
 *   move[1] … 奥行き（ワールド Z）。負が奥。2D 投影の世代では物理側が Z 速度を潰すため、
 *             この成分は「入力としては存在するが効かない」状態になる（不変条件 I1）
 *
 * 制約の適用はここではなく `constraints.ts` が行う。§4.4 の進行順序が
 * 「1. 入力サンプリング → 2. 世代切替 → 3. 制約適用」であり、
 * **同じティック内で切り替えた世代の制約が即座に効く**必要があるため。
 */
import { GENERATION_IDS, type GenerationId } from '@/generation/profiles';

/** 左右と奥行きの 2 軸。gameplay/projection.ts の Vec3 と同じくタプルで持つ */
export type Vec2 = [number, number];

export interface ButtonState {
  down: boolean;
  /** このティックで押された */
  pressed: boolean;
  /** このティックで離された */
  released: boolean;
  /** 押しっぱなしの時間（ミリ秒）。感圧の代替に使う（GAME_PLAN §10.1） */
  heldMs: number;
}

/** 感圧のフルスケールに達する押下時間（GAME_PLAN §10.1：0.5 秒でフル） */
export const PRESSURE_FULL_MS = 500;

/** 入力ソースが返す生の値。世代を知らないし、制約も知らない */
export interface RawInput {
  /**
   * 左右と奥行き（-1..1、奥が負）。**画面に対する向き**であって、ワールドの軸ではない。
   * ワールドへ直すのは `gameplay/player.ts` で、カメラの向きを基底に取る（T2-08）
   */
  move: Vec2;
  /** アナログ代替の「歩き」モード（キーボードの Shift）。GAME_PLAN §10.1 */
  fine: boolean;
  jump: boolean;
  action: boolean;
  subAction: boolean;
  /** アナログの押し込み量 0..1。キーボードは常に 0（押下時間から作る） */
  pressureAnalog: number;
  /** 感圧ボタンが押されているか（キーボードの長押し代替） */
  pressureButton: boolean;
  /** 直接指定の切替。押された瞬間の 1 ティックだけ非 null */
  switchTo: GenerationId | null;
  /** 隣接世代への巡回。押された瞬間の 1 ティックだけ非 0 */
  switchCycle: -1 | 0 | 1;
  /**
   * 直近に押された移動軸（0 = 左右 / 1 = 奥行き）。
   * 第1世代の 4 方向化で「同値のときにどちらを残すか」を決める（GAME_PLAN §10.4）。
   * 軸の押し順を知っているのはソースだけなので、ここで運ぶ
   */
  lastAxis: 0 | 1 | null;
}

export function createRawInput(): RawInput {
  return {
    move: [0, 0],
    fine: false,
    jump: false,
    action: false,
    subAction: false,
    pressureAnalog: 0,
    pressureButton: false,
    switchTo: null,
    switchCycle: 0,
    lastAxis: null,
  };
}

export interface InputSnapshot {
  /** 世代制約の適用後（constraints.ts が書く）。ゲームロジックはこれを使う */
  move: Vec2;
  /** 制約適用前。デバッグとチュートリアル表示用（§5.7） */
  moveRaw: Vec2;
  jump: ButtonState;
  action: ButtonState;
  subAction: ButtonState;
  /** 0..1。感圧を持たない世代では常に 0 */
  pressure: number;
  switchTo: GenerationId | null;
  switchCycle: -1 | 0 | 1;
  /** 制約適用の材料。ゲームロジックは見ない */
  fine: boolean;
  lastAxis: 0 | 1 | null;
}

/** ソースが持つべきもの。追加のソースはこれを満たすだけでよい（GAME_PLAN §10.3） */
export interface InputSource {
  /** このティックの生入力。未接続などで入力が無いときは null */
  read(): RawInput | null;
}

/** キーボードのキー名 → 世代の対応（`1`〜`4`）。世代 ID を直接書かない（不変条件 I2） */
export function generationForSlot(slot: number): GenerationId | null {
  return GENERATION_IDS[slot] ?? null;
}

function createButtonState(): ButtonState {
  return { down: false, pressed: false, released: false, heldMs: 0 };
}

function updateButton(state: ButtonState, down: boolean, dtMs: number): void {
  state.pressed = down && !state.down;
  state.released = !down && state.down;
  state.heldMs = down ? (state.pressed ? 0 : state.heldMs + dtMs) : 0;
  state.down = down;
}

export interface Mapper {
  /** 直近のスナップショット。毎ティック同じオブジェクトを使い回す（割り当てを増やさない） */
  readonly snapshot: InputSnapshot;
  /** §4.4 の段階 1。dtMs は感圧の代替に使うだけで、シミュレーションには渡らない */
  sample(raw: RawInput | null, dtMs?: number): InputSnapshot;
}

/**
 * `RawInput` を `InputSnapshot` に変換する。ここが持つ状態はボタンの前ティックの値だけ。
 * 制約は適用しない（§4.4 の段階 3 で `constraints.applyConstraints` が行う）。
 */
export function createMapper(): Mapper {
  const snapshot: InputSnapshot = {
    move: [0, 0],
    moveRaw: [0, 0],
    jump: createButtonState(),
    action: createButtonState(),
    subAction: createButtonState(),
    pressure: 0,
    switchTo: null,
    switchCycle: 0,
    fine: false,
    lastAxis: null,
  };
  // 感圧の代替（押下時間）を測るためだけのボタン。スナップショットには出さない
  const pressureButton = createButtonState();

  return {
    snapshot,
    sample(raw, dtMs = 1000 / 60): InputSnapshot {
      const input = raw ?? createRawInput();

      snapshot.moveRaw[0] = input.move[0];
      snapshot.moveRaw[1] = input.move[1];
      // 制約適用前の値をいったんそのまま入れる。段階 3 で上書きされる
      snapshot.move[0] = input.move[0];
      snapshot.move[1] = input.move[1];

      updateButton(snapshot.jump, input.jump, dtMs);
      updateButton(snapshot.action, input.action, dtMs);
      updateButton(snapshot.subAction, input.subAction, dtMs);
      updateButton(pressureButton, input.pressureButton, dtMs);

      // アナログの実値があればそれを使い、無ければ押下時間で代替する（GAME_PLAN §10.1 / §10.2）
      const held = pressureButton.down ? Math.min(pressureButton.heldMs / PRESSURE_FULL_MS, 1) : 0;
      snapshot.pressure = Math.max(Math.min(Math.max(input.pressureAnalog, 0), 1), held);

      snapshot.switchTo = input.switchTo;
      snapshot.switchCycle = input.switchCycle;
      snapshot.fine = input.fine;
      snapshot.lastAxis = input.lastAxis;
      return snapshot;
    },
  };
}

/**
 * 複数のソースを 1 つの生入力にまとめる。
 * ゲームパッドは**必須にしない**（GAME_PLAN §10.2）ので、
 * 「繋いだ瞬間にキーボードが死ぬ」ことがないよう、両方を素直に足し合わせる。
 */
export function combineRawInputs(inputs: readonly (RawInput | null)[]): RawInput {
  const out = createRawInput();
  let bestMagnitude = -1;
  for (const input of inputs) {
    if (!input) continue;
    // 移動は「より大きく倒している方」を採用する（両方から同時に半端な値が混ざらない）
    const magnitude = Math.hypot(input.move[0], input.move[1]);
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      out.move[0] = input.move[0];
      out.move[1] = input.move[1];
      if (input.lastAxis !== null) out.lastAxis = input.lastAxis;
    }
    out.fine = out.fine || input.fine;
    out.jump = out.jump || input.jump;
    out.action = out.action || input.action;
    out.subAction = out.subAction || input.subAction;
    out.pressureButton = out.pressureButton || input.pressureButton;
    out.pressureAnalog = Math.max(out.pressureAnalog, input.pressureAnalog);
    out.switchTo = out.switchTo ?? input.switchTo;
    if (out.switchCycle === 0) out.switchCycle = input.switchCycle;
  }
  return out;
}
