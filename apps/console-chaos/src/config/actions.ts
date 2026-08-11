import {
  createActionMap,
  defineActions,
  type ActionSnapshot,
  type ButtonActionValue,
} from '@console-chaos/engine';

export const CONSOLE_CHAOS_ACTIONS = defineActions({
  move: 'axis2d',
  fine: 'button',
  jump: 'button',
  action: 'button',
  subAction: 'button',
  pressure: 'button',
  switchPrevious: 'button',
  switchNext: 'button',
  switch1: 'button',
  switch2: 'button',
  switch3: 'button',
  switch4: 'button',
});

export type ConsoleChaosActionSnapshot = ActionSnapshot<typeof CONSOLE_CHAOS_ACTIONS>;

function neutralButton(): ButtonActionValue {
  return { down: false, pressed: false, released: false, value: 0, heldMs: 0 };
}

export function createNeutralConsoleChaosActions(): ConsoleChaosActionSnapshot {
  return {
    move: [0, 0],
    fine: neutralButton(),
    jump: neutralButton(),
    action: neutralButton(),
    subAction: neutralButton(),
    pressure: neutralButton(),
    switchPrevious: neutralButton(),
    switchNext: neutralButton(),
    switch1: neutralButton(),
    switch2: neutralButton(),
    switch3: neutralButton(),
    switch4: neutralButton(),
  };
}

export function createConsoleChaosActionMap() {
  return createActionMap(CONSOLE_CHAOS_ACTIONS, {
    move: {
      leftKeys: ['ArrowLeft', 'KeyA'],
      rightKeys: ['ArrowRight', 'KeyD'],
      upKeys: ['ArrowUp', 'KeyW'],
      downKeys: ['ArrowDown', 'KeyS'],
      gamepadAxes: [0, 1],
      gamepadDeadzone: 0.25,
      tieBreak: 'last',
    },
    fine: { keys: ['ShiftLeft', 'ShiftRight'] },
    jump: { keys: ['Space'], gamepadButtons: [0] },
    action: { keys: ['KeyJ'], gamepadButtons: [2] },
    subAction: { keys: ['KeyK'], gamepadButtons: [3] },
    pressure: { keys: ['KeyL'], gamepadButtons: [7], holdRampMs: 500, requiresPressure: true },
    switchPrevious: { keys: ['KeyQ'], gamepadButtons: [4] },
    switchNext: { keys: ['KeyE'], gamepadButtons: [5] },
    switch1: { keys: ['Digit1'] },
    switch2: { keys: ['Digit2'] },
    switch3: { keys: ['Digit3'] },
    switch4: { keys: ['Digit4'] },
  });
}
