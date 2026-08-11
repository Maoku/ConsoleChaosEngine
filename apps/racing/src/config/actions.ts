import { createActionMap, defineActions } from '@console-chaos/engine';

export const RACING_ACTIONS = defineActions({
  steer: 'axis1d',
  accelerate: 'button',
  brake: 'button',
  reset: 'button',
  switchPrevious: 'button',
  switchNext: 'button',
  switch1: 'button',
  switch2: 'button',
  switch3: 'button',
  switch4: 'button',
});

export type RacingActionDefinition = typeof RACING_ACTIONS;

export function createRacingActionMap() {
  return createActionMap(RACING_ACTIONS, {
    steer: { negativeKeys: ['ArrowLeft', 'KeyA'], positiveKeys: ['ArrowRight', 'KeyD'], gamepadAxis: 0 },
    accelerate: { keys: ['ArrowUp', 'KeyW'], gamepadButtons: [7, 0] },
    brake: { keys: ['ArrowDown', 'KeyS'], gamepadButtons: [6, 1] },
    reset: { keys: ['KeyR'], gamepadButtons: [3] },
    switchPrevious: { keys: ['KeyQ'], gamepadButtons: [4] },
    switchNext: { keys: ['KeyE'], gamepadButtons: [5] },
    switch1: { keys: ['Digit1'] },
    switch2: { keys: ['Digit2'] },
    switch3: { keys: ['Digit3'] },
    switch4: { keys: ['Digit4'] },
  });
}

