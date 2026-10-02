import type { DeviceSnapshot } from '@console-chaos/engine';
/** Recreating an ActionMap does not clear values held at a stage boundary. */
export function createReleaseGuard() {
  let locked = true;
  let captured: DeviceSnapshot | null = null;
  return {
    lock(device?: DeviceSnapshot): void { locked = true; captured = device ?? null; },
    accept(device: DeviceSnapshot): boolean {
      if (!locked) return true;
      const keysHeld = captured ? [...captured.keys].some((key) => device.keys.has(key)) : device.keys.size > 0;
      const buttonsHeld = captured
        ? [...captured.gamepadButtons].some(([id, value]) => value > 0.25 && (device.gamepadButtons.get(id) ?? 0) > 0.25)
        : [...device.gamepadButtons.values()].some((v) => v > 0.25);
      const axesHeld = captured
        ? captured.gamepadAxes.some((value, axis) => Math.abs(value) > 0.25 && Math.abs(device.gamepadAxes[axis] ?? 0) > 0.25)
        : device.gamepadAxes.some((v) => Math.abs(v) > 0.25);
      if (keysHeld || buttonsHeld || axesHeld) return false;
      locked = false;
      return false;
    },
  };
}
