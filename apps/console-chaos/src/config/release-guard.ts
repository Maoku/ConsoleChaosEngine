import type { DeviceSnapshot } from '@console-chaos/engine';
/** Recreating an ActionMap does not clear held keyboard/gamepad values at a stage boundary. */
export function createReleaseGuard() {
  let locked = true;
  return {
    lock(): void { locked = true; },
    accept(device: DeviceSnapshot): boolean {
      if (!locked) return true;
      if (device.keys.size || [...device.gamepadButtons.values()].some((v) => v > 0.25) || device.gamepadAxes.some((v) => Math.abs(v) > 0.25)) return false;
      locked = false;
      return false;
    },
  };
}
