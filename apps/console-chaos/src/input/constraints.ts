/**
 * 世代ごとの入力制約（IMPLEMENTATION_PLAN §5.7 の制約表、GAME_PLAN §10、T1-04）。
 *
 * §4.4 の段階 3。世代切替（段階 2）の直後に走るので、
 * **切り替えたその瞬間から新しい世代の制約が効く**。
 *
 * 不変条件 I2: ここには世代 ID の分岐が 1 つも無い。判断の材料は
 * `GenerationProfile` の値（`input.allowDiagonal` など）だけで、
 * 世代を増やしてもこのファイルは変わらない。
 *
 * §5.7 の表との対応:
 *   第1世代の 4 方向化   … allowDiagonal === false
 *   第1/第2世代のデジタル化 … directional !== 'analog'
 *   第3/第4世代のアナログ  … directional === 'analog'（キーボードは Shift で 2 段階）
 *   第4世代の感圧        … pressureSensitive
 */
import type { GenerationProfile } from '@/generation/profiles';
import type { ButtonState, InputSnapshot, Vec2 } from './mapper';

/**
 * キーボードの「歩き」モードの速度比（GAME_PLAN §10.1 の 2 段階速度）。
 * アナログを持つ世代でのみ効く。スティックの中間の倒し具合を大まかに再現する値
 */
export const FINE_MOVE_SCALE = 0.45;

/** これ未満の倒し込みは 0 と見なす（デジタル化のしきい値） */
const DIGITAL_THRESHOLD = 0.001;

function digitize(value: number): number {
  if (value > DIGITAL_THRESHOLD) return 1;
  if (value < -DIGITAL_THRESHOLD) return -1;
  return 0;
}

/**
 * 斜めを 1 軸に落とす。絶対値が大きい方を残し、**同値なら直近に押された軸を優先**する
 *（GAME_PLAN §10.4：意図しない停止を防ぐ）。押し順が不明なら左右を残す
 */
function collapseToSingleAxis(move: Vec2, lastAxis: 0 | 1 | null): void {
  const x = Math.abs(move[0]);
  const y = Math.abs(move[1]);
  if (x === 0 || y === 0) return;
  const keep: 0 | 1 = x === y ? (lastAxis ?? 0) : x > y ? 0 : 1;
  move[keep === 0 ? 1 : 0] = 0;
}

/** 世代が持たないボタンは「押されていない」に潰す（GAME_PLAN §10.1 の ✗） */
function neutralize(button: ButtonState): void {
  button.down = false;
  button.pressed = false;
  button.released = false;
  button.heldMs = 0;
}

/**
 * スナップショットへ世代制約を適用する（その場で書き換える）。
 * `moveRaw` は触らないので、チュートリアルやデバッグ表示は
 * 「プレイヤーが入れた値」と「世代が許した値」を並べて見せられる。
 */
export function applyConstraints(snapshot: InputSnapshot, profile: GenerationProfile): InputSnapshot {
  const { input, action } = profile;
  const move = snapshot.move;
  move[0] = snapshot.moveRaw[0];
  move[1] = snapshot.moveRaw[1];

  if (!input.allowDiagonal) collapseToSingleAxis(move, snapshot.lastAxis);

  if (input.directional === 'analog') {
    // 円の外へはみ出さない（キーボードの (1,1) がスティックより速くならないように）
    const magnitude = Math.hypot(move[0], move[1]);
    if (magnitude > 1) {
      move[0] /= magnitude;
      move[1] /= magnitude;
    }
    // キーボードのアナログ代替。微調整を許す世代でのみ効く（§5.7）
    if (snapshot.fine && action.fineControl) {
      move[0] *= FINE_MOVE_SCALE;
      move[1] *= FINE_MOVE_SCALE;
    }
  } else {
    // 方向キー相当の世代は符号だけに落とす。半端な速度は存在しない
    move[0] = digitize(move[0]);
    move[1] = digitize(move[1]);
  }

  if (!input.buttons.includes('jump')) neutralize(snapshot.jump);
  if (!input.buttons.includes('action')) neutralize(snapshot.action);
  if (!input.buttons.includes('subAction')) neutralize(snapshot.subAction);

  if (!input.pressureSensitive) snapshot.pressure = 0;

  return snapshot;
}
