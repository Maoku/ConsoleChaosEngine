import { createActionMap, defineActions } from '@console-chaos/engine';

export const TITLE_ACTIONS = defineActions({
  switchPrevious: 'button',
  switchNext: 'button',
  switch1: 'button',
  switch2: 'button',
  switch3: 'button',
  switch4: 'button',
});

export function createTitleActionMap() {
  return createActionMap(TITLE_ACTIONS, {
    switchPrevious: { keys: ['KeyQ'], gamepadButtons: [4] },
    switchNext: { keys: ['KeyE'], gamepadButtons: [5] },
    switch1: { keys: ['Digit1'] },
    switch2: { keys: ['Digit2'] },
    switch3: { keys: ['Digit3'] },
    switch4: { keys: ['Digit4'] },
  });
}
