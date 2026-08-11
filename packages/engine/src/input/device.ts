import { createDeviceSnapshot, type DeviceSnapshot } from './actions';

export interface DeviceInputSource {
  poll(): DeviceSnapshot;
  dispose(): void;
}

export function createKeyboardGamepadSource(target: Window = window): DeviceInputSource {
  const keys = new Set<string>();
  const latchedKeys = new Set<string>();
  let lastAxis: 0 | 1 | null = null;
  const keyDown = (event: KeyboardEvent): void => {
    if (!keys.has(event.code)) {
      latchedKeys.add(event.code);
      if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(event.code)) lastAxis = 0;
      if (['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'].includes(event.code)) lastAxis = 1;
    }
    keys.add(event.code);
  };
  const keyUp = (event: KeyboardEvent): void => {
    keys.delete(event.code);
  };
  const blur = (): void => {
    keys.clear();
    latchedKeys.clear();
    lastAxis = null;
  };
  target.addEventListener('keydown', keyDown);
  target.addEventListener('keyup', keyUp);
  target.addEventListener('blur', blur);

  return {
    poll(): DeviceSnapshot {
      const gamepad = navigator.getGamepads?.().find((candidate) => candidate?.connected) ?? null;
      const buttons = gamepad?.buttons.map((button, index) => [index, button.value] as const) ?? [];
      const sampledKeys = latchedKeys.size > 0 ? new Set([...keys, ...latchedKeys]) : keys;
      latchedKeys.clear();
      return createDeviceSnapshot(sampledKeys, buttons, gamepad ? [...gamepad.axes] : [], lastAxis);
    },
    dispose(): void {
      target.removeEventListener('keydown', keyDown);
      target.removeEventListener('keyup', keyUp);
      target.removeEventListener('blur', blur);
      keys.clear();
      latchedKeys.clear();
      lastAxis = null;
    },
  };
}

export function createNullInputSource(): DeviceInputSource {
  const snapshot = createDeviceSnapshot();
  return { poll: () => snapshot, dispose: () => {} };
}
