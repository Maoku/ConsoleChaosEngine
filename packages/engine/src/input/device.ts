import { createDeviceSnapshot, type DeviceSnapshot } from './actions';

export interface DeviceInputSource {
  poll(): DeviceSnapshot;
  dispose(): void;
}

export function createKeyboardGamepadSource(target: Window = window): DeviceInputSource {
  const keys = new Set<string>();
  const keyDown = (event: KeyboardEvent): void => {
    keys.add(event.code);
  };
  const keyUp = (event: KeyboardEvent): void => {
    keys.delete(event.code);
  };
  const blur = (): void => keys.clear();
  target.addEventListener('keydown', keyDown);
  target.addEventListener('keyup', keyUp);
  target.addEventListener('blur', blur);

  return {
    poll(): DeviceSnapshot {
      const gamepad = navigator.getGamepads?.().find((candidate) => candidate?.connected) ?? null;
      const buttons = gamepad?.buttons.map((button, index) => [index, button.value] as const) ?? [];
      return createDeviceSnapshot(keys, buttons, gamepad ? [...gamepad.axes] : []);
    },
    dispose(): void {
      target.removeEventListener('keydown', keyDown);
      target.removeEventListener('keyup', keyUp);
      target.removeEventListener('blur', blur);
      keys.clear();
    },
  };
}

export function createNullInputSource(): DeviceInputSource {
  const snapshot = createDeviceSnapshot();
  return { poll: () => snapshot, dispose: () => {} };
}
