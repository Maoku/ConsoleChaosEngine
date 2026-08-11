import { describe, it, expect } from 'vitest';
import {
  combineRawInputs,
  createMapper,
  createRawInput,
  generationForSlot,
  PRESSURE_FULL_MS,
  type InputSnapshot,
  type RawInput,
} from '@/input/mapper';
import { applyConstraints, FINE_MOVE_SCALE } from '@/input/constraints';
import {
  BUFFER_FRAMES,
  COYOTE_FRAMES,
  cancelCoyote,
  consumeActionBuffer,
  createActionBuffer,
  updateActionBuffer,
} from '@/input/buffer';
import { createKeyboardSource } from '@/input/source_keyboard';
import { createGamepadSource, STICK_DEADZONE, type GamepadLike } from '@/input/source_gamepad';
import { GENERATION_IDS, PROFILES, type GenerationId } from '@/generation/profiles';
import { TICK_MS } from '@/core/time';

/** 生入力を 1 ティック分流し、世代制約まで適用したスナップショットを得る */
function snapshotFor(generation: GenerationId, raw: Partial<RawInput>, dtMs = TICK_MS): InputSnapshot {
  const mapper = createMapper();
  return applyConstraints(mapper.sample({ ...createRawInput(), ...raw }, dtMs), PROFILES[generation]);
}

describe('input/constraints（§5.7 の制約表）', () => {
  it('第1世代は 4 方向化される。絶対値の大きい軸だけが残る', () => {
    const snapshot = snapshotFor('FC', { move: [0.8, 0.3] });
    expect(snapshot.move).toEqual([1, 0]);
    // 制約適用前は残っている（チュートリアル表示用。§5.7）
    expect(snapshot.moveRaw).toEqual([0.8, 0.3]);
  });

  it('第1世代の斜め同値は、直近に押された軸を優先する（GAME_PLAN §10.4）', () => {
    expect(snapshotFor('FC', { move: [1, 1], lastAxis: 1 }).move).toEqual([0, 1]);
    expect(snapshotFor('FC', { move: [1, 1], lastAxis: 0 }).move).toEqual([1, 0]);
    // 押し順が分からない場合（スティック）は左右を残す
    expect(snapshotFor('FC', { move: [1, 1], lastAxis: null }).move).toEqual([1, 0]);
  });

  it('第2世代は斜めを許すが、値は符号だけに落ちる（デジタル化）', () => {
    const snapshot = snapshotFor('SFC', { move: [0.4, -0.9] });
    expect(snapshot.move).toEqual([1, -1]);
  });

  it('第3・第4世代はアナログの値をそのまま通す', () => {
    expect(snapshotFor('PS1', { move: [0.4, -0.25] }).move).toEqual([0.4, -0.25]);
    expect(snapshotFor('PS2', { move: [0.4, -0.25] }).move).toEqual([0.4, -0.25]);
  });

  it('アナログ世代では斜めの合成速度が 1 を超えない（キーボードが有利にならない）', () => {
    const snapshot = snapshotFor('PS1', { move: [1, 1] });
    expect(Math.hypot(snapshot.move[0], snapshot.move[1])).toBeCloseTo(1, 6);
  });

  it('Shift の 2 段階速度はアナログ世代でのみ効く（§5.7 / GAME_PLAN §10.1）', () => {
    expect(snapshotFor('PS1', { move: [1, 0], fine: true }).move[0]).toBeCloseTo(FINE_MOVE_SCALE, 6);
    // 微調整を持たない世代では Shift を押しても速度が変わらない
    expect(snapshotFor('FC', { move: [1, 0], fine: true }).move[0]).toBe(1);
    expect(snapshotFor('SFC', { move: [1, 0], fine: true }).move[0]).toBe(1);
  });

  it('世代が持たないボタンは押しても反応しない（GAME_PLAN §10.1 の ✗）', () => {
    const fc = snapshotFor('FC', { jump: true, action: true, subAction: true });
    expect(fc.jump.down).toBe(true);
    expect(fc.action.down).toBe(true);
    expect(fc.subAction.down).toBe(false);
    expect(fc.subAction.pressed).toBe(false);

    const sfc = snapshotFor('SFC', { subAction: true });
    expect(sfc.subAction.down).toBe(true);
  });

  it('感圧は第4世代でのみ 0 以外になる', () => {
    for (const id of GENERATION_IDS) {
      const snapshot = snapshotFor(id, { pressureAnalog: 0.7 });
      expect(snapshot.pressure).toBe(PROFILES[id].input.pressureSensitive ? 0.7 : 0);
    }
  });

  it('制約は世代切替の直後から効く（§4.4 の段階 2 → 3）', () => {
    const mapper = createMapper();
    const raw = { ...createRawInput(), move: [0.8, 0.3] as [number, number] };
    // 同じ生入力でも、その時の世代で結果が変わる
    expect(applyConstraints(mapper.sample(raw), PROFILES.PS1).move).toEqual([0.8, 0.3]);
    expect(applyConstraints(mapper.sample(raw), PROFILES.FC).move).toEqual([1, 0]);
  });
});

describe('input/mapper（抽象入力）', () => {
  it('押下・離上のエッジと押しっぱなし時間を持つ', () => {
    const mapper = createMapper();
    const held = { ...createRawInput(), jump: true };

    let snapshot = mapper.sample(held, 16);
    expect(snapshot.jump).toMatchObject({ down: true, pressed: true, released: false, heldMs: 0 });

    snapshot = mapper.sample(held, 16);
    expect(snapshot.jump).toMatchObject({ down: true, pressed: false, heldMs: 16 });

    snapshot = mapper.sample(createRawInput(), 16);
    expect(snapshot.jump).toMatchObject({ down: false, pressed: false, released: true, heldMs: 0 });
  });

  it('キーボードの感圧代替は 0.5 秒でフルスケールになる（GAME_PLAN §10.1）', () => {
    const mapper = createMapper();
    const raw = { ...createRawInput(), pressureButton: true };
    mapper.sample(raw, PRESSURE_FULL_MS / 2);
    expect(mapper.sample(raw, PRESSURE_FULL_MS / 2).pressure).toBeCloseTo(0.5, 6);
    expect(mapper.sample(raw, PRESSURE_FULL_MS).pressure).toBe(1);
    // 離せば 0 に戻る
    expect(mapper.sample(createRawInput(), 16).pressure).toBe(0);
  });

  it('入力が無い（ソース未接続）ときは中立のスナップショットになる', () => {
    const mapper = createMapper();
    const snapshot = mapper.sample(null);
    expect(snapshot.move).toEqual([0, 0]);
    expect(snapshot.jump.down).toBe(false);
    expect(snapshot.switchTo).toBeNull();
  });

  it('スナップショットは同じオブジェクトを使い回す（毎ティックの割り当てを増やさない）', () => {
    const mapper = createMapper();
    expect(mapper.sample(createRawInput())).toBe(mapper.snapshot);
  });

  it('世代スロットは並び順で対応し、範囲外は null', () => {
    expect(generationForSlot(0)).toBe(GENERATION_IDS[0]);
    expect(generationForSlot(3)).toBe(GENERATION_IDS[3]);
    expect(generationForSlot(4)).toBeNull();
  });

  it('複数ソースは足し合わせる。ゲームパッドを繋いでもキーボードは死なない（§10.2）', () => {
    const keyboard: RawInput = { ...createRawInput(), move: [1, 0], jump: true, lastAxis: 0 };
    const pad: RawInput = { ...createRawInput(), move: [0.2, 0.2], action: true, pressureAnalog: 0.5 };
    const merged = combineRawInputs([keyboard, pad]);
    // 移動は「より大きく倒している方」
    expect(merged.move).toEqual([1, 0]);
    expect(merged.jump).toBe(true);
    expect(merged.action).toBe(true);
    expect(merged.pressureAnalog).toBe(0.5);
    expect(merged.lastAxis).toBe(0);
    // null（未接続）が混ざっても壊れない
    expect(combineRawInputs([null, pad]).move).toEqual([0.2, 0.2]);
  });
});

describe('input/buffer（入力バッファ 8F / コヨーテ 6F、GAME_PLAN §10.4）', () => {
  it('接地中に押せばそのティックで成立する', () => {
    const buffer = createActionBuffer();
    updateActionBuffer(buffer, true, true);
    expect(consumeActionBuffer(buffer)).toBe(true);
    // 消費済みなので 1 回の押下で 2 回は成立しない
    expect(consumeActionBuffer(buffer)).toBe(false);
  });

  it('押したティックを含めて 8 フレーム、着地を待てる', () => {
    const buffer = createActionBuffer();
    updateActionBuffer(buffer, true, false); // 空中で押した（0 ティック目）
    for (let frame = 1; frame < BUFFER_FRAMES - 1; frame++) {
      updateActionBuffer(buffer, false, false);
      expect(consumeActionBuffer(buffer)).toBe(false);
    }
    updateActionBuffer(buffer, false, true); // 7 ティック目に着地
    expect(consumeActionBuffer(buffer)).toBe(true);
  });

  it('8 フレームを超えた押下は忘れる', () => {
    const buffer = createActionBuffer();
    updateActionBuffer(buffer, true, false);
    for (let frame = 1; frame < BUFFER_FRAMES; frame++) updateActionBuffer(buffer, false, false);
    updateActionBuffer(buffer, false, true); // 8 ティック目の着地では遅い
    expect(consumeActionBuffer(buffer)).toBe(false);
  });

  it('地面を離れて 6 フレームまではジャンプできる（コヨーテタイム）', () => {
    const buffer = createActionBuffer();
    updateActionBuffer(buffer, false, true); // 最後に接地したティック
    for (let frame = 1; frame < COYOTE_FRAMES; frame++) updateActionBuffer(buffer, false, false);
    updateActionBuffer(buffer, true, false); // 6 ティック目に押した
    expect(consumeActionBuffer(buffer)).toBe(true);
  });

  it('6 フレームを超えると猶予は切れる', () => {
    const buffer = createActionBuffer();
    updateActionBuffer(buffer, false, true);
    for (let frame = 1; frame <= COYOTE_FRAMES; frame++) updateActionBuffer(buffer, false, false);
    updateActionBuffer(buffer, true, false); // 7 ティック目
    expect(consumeActionBuffer(buffer)).toBe(false);
  });

  it('猶予は明示的に打ち切れる', () => {
    const buffer = createActionBuffer();
    updateActionBuffer(buffer, true, true);
    cancelCoyote(buffer);
    expect(consumeActionBuffer(buffer)).toBe(false);
  });
});

describe('input/source_keyboard（GAME_PLAN §10.1）', () => {
  it('WASD と方向キーの両方が同じ軸へ効き、反対方向の同時押しは相殺する', () => {
    const keyboard = createKeyboardSource();
    keyboard.press('d');
    expect(keyboard.read().move).toEqual([1, 0]);
    keyboard.press('ArrowLeft');
    expect(keyboard.read().move).toEqual([0, 0]);
    keyboard.release('ArrowLeft');
    keyboard.press('w');
    expect(keyboard.read().move).toEqual([1, -1]);
  });

  it('直近に押された移動軸を覚えている（4 方向化の優先に使う）', () => {
    const keyboard = createKeyboardSource();
    keyboard.press('d');
    expect(keyboard.read().lastAxis).toBe(0);
    keyboard.press('s');
    expect(keyboard.read().lastAxis).toBe(1);
    // 第1世代ではその軸が残る
    expect(applyConstraints(createMapper().sample(keyboard.read()), PROFILES.FC).move).toEqual([0, 1]);
  });

  it('ボタンと Shift が割り当てどおりに読める', () => {
    const keyboard = createKeyboardSource();
    keyboard.press(' ');
    keyboard.press('j');
    keyboard.press('k');
    keyboard.press('l');
    keyboard.press('Shift');
    const raw = keyboard.read();
    expect(raw).toMatchObject({ jump: true, action: true, subAction: true, pressureButton: true, fine: true });
  });

  it('大文字（Shift 併用）でも同じキーとして扱う', () => {
    const keyboard = createKeyboardSource();
    keyboard.press('D');
    expect(keyboard.read().move).toEqual([1, 0]);
    keyboard.release('d');
    expect(keyboard.read().move).toEqual([0, 0]);
  });

  it('世代切替は押した瞬間の 1 ティックだけ立つ（押しっぱなしで連続切替しない）', () => {
    const keyboard = createKeyboardSource();
    keyboard.press('3');
    expect(keyboard.read().switchTo).toBe(GENERATION_IDS[2]);
    expect(keyboard.read().switchTo).toBeNull();

    keyboard.press('e');
    expect(keyboard.read().switchCycle).toBe(1);
    expect(keyboard.read().switchCycle).toBe(0);
    keyboard.release('e');
    keyboard.press('q');
    expect(keyboard.read().switchCycle).toBe(-1);
  });

  it('キーリピートは押下として扱わない', () => {
    const keyboard = createKeyboardSource();
    keyboard.press('2');
    expect(keyboard.read().switchTo).toBe(GENERATION_IDS[1]);
    keyboard.press('2'); // OS のリピート
    expect(keyboard.read().switchTo).toBeNull();
  });

  it('DOM のイベントから駆動でき、解除もできる', () => {
    const keyboard = createKeyboardSource();
    const target = new EventTarget();
    const detach = keyboard.attach(target);

    const keyEvent = (type: string, key: string): Event => Object.assign(new Event(type), { key });
    target.dispatchEvent(keyEvent('keydown', 'd'));
    expect(keyboard.read().move).toEqual([1, 0]);

    // フォーカスを失ったら押しっぱなしを解消する
    target.dispatchEvent(new Event('blur'));
    expect(keyboard.read().move).toEqual([0, 0]);

    detach();
    target.dispatchEvent(keyEvent('keydown', 'd'));
    expect(keyboard.read().move).toEqual([0, 0]);
  });
});

describe('input/source_gamepad（GAME_PLAN §10.2）', () => {
  function pad(overrides: Partial<GamepadLike> = {}): GamepadLike {
    return {
      connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
      ...overrides,
    };
  }

  it('未接続なら null を返す（キーボードだけで成立する）', () => {
    expect(createGamepadSource(() => []).read()).toBeNull();
    expect(createGamepadSource(() => [null]).read()).toBeNull();
    expect(createGamepadSource(() => [pad({ connected: false })]).read()).toBeNull();
  });

  it('スティックはデッドゾーンの外側を 0..1 へ引き伸ばす', () => {
    const source = createGamepadSource(() => [pad({ axes: [STICK_DEADZONE / 2, 1, 0, 0] })]);
    const raw = source.read()!;
    expect(raw.move[0]).toBe(0);
    expect(raw.move[1]).toBe(1);
  });

  it('方向パッドはアナログと合成される', () => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    buttons[15] = { pressed: true, value: 1 }; // 右
    const raw = createGamepadSource(() => [pad({ buttons })]).read()!;
    expect(raw.move).toEqual([1, 0]);
  });

  it('トリガーの実値がそのまま感圧になる（押下時間の代替を使わない）', () => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    buttons[7] = { pressed: true, value: 0.6 };
    const raw = createGamepadSource(() => [pad({ buttons })]).read()!;
    expect(raw.pressureAnalog).toBeCloseTo(0.6, 6);
    expect(raw.pressureButton).toBe(false);
  });

  it('ショルダーの巡回は押した瞬間だけ立つ', () => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    const source = createGamepadSource(() => [pad({ buttons })]);
    buttons[5] = { pressed: true, value: 1 };
    expect(source.read()!.switchCycle).toBe(1);
    expect(source.read()!.switchCycle).toBe(0);
    buttons[5] = { pressed: false, value: 0 };
    buttons[4] = { pressed: true, value: 1 };
    expect(source.read()!.switchCycle).toBe(-1);
  });

  it('世代の直接指定はゲームパッドに割り当てない（L / R の巡回のみ）', () => {
    expect(createGamepadSource(() => [pad()]).read()!.switchTo).toBeNull();
  });
});
