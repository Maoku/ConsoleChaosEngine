import type { HardwareGenerationProfile } from '../generation/profiles';

export type ActionKind = 'button' | 'axis1d' | 'axis2d';
export type ActionDefinition = Readonly<Record<string, ActionKind>>;

export interface ButtonActionValue {
  down: boolean;
  pressed: boolean;
  released: boolean;
  value: number;
  heldMs: number;
}

export type ActionValue<Kind extends ActionKind> = Kind extends 'button'
  ? ButtonActionValue
  : Kind extends 'axis1d'
    ? number
    : readonly [number, number];

export type ActionSnapshot<Definition extends ActionDefinition> = {
  readonly [Key in keyof Definition]: ActionValue<Definition[Key]>;
};

export interface DeviceSnapshot {
  readonly keys: ReadonlySet<string>;
  readonly gamepadButtons: ReadonlyMap<number, number>;
  readonly gamepadAxes: readonly number[];
  readonly lastAxis: 0 | 1 | null;
}

export interface ButtonBinding {
  keys?: readonly string[];
  gamepadButtons?: readonly number[];
  /** Keyboard hold time is mapped from 0..holdRampMs to an analog 0..1 value. */
  holdRampMs?: number;
  /** The value is neutral on hardware profiles without pressure sensitivity. */
  requiresPressure?: boolean;
}

export interface Axis1dBinding {
  negativeKeys?: readonly string[];
  positiveKeys?: readonly string[];
  gamepadAxis?: number;
}

export interface Axis2dBinding {
  leftKeys?: readonly string[];
  rightKeys?: readonly string[];
  upKeys?: readonly string[];
  downKeys?: readonly string[];
  gamepadAxes?: readonly [number, number];
  gamepadDeadzone?: number;
  tieBreak?: 'x' | 'y' | 'last';
}

export type ActionBinding = ButtonBinding | Axis1dBinding | Axis2dBinding;
export type ActionBindings<Definition extends ActionDefinition> = {
  readonly [Key in keyof Definition]: ActionBinding;
};

export interface ActionMap<Definition extends ActionDefinition> {
  readonly definition: Definition;
  sample(device: DeviceSnapshot, profile: HardwareGenerationProfile, dtMs?: number): ActionSnapshot<Definition>;
  reset(): void;
}

export function defineActions<const Definition extends ActionDefinition>(definition: Definition): Definition {
  return definition;
}

export function createDeviceSnapshot(
  keys: Iterable<string> = [],
  gamepadButtons: Iterable<readonly [number, number]> = [],
  gamepadAxes: readonly number[] = [],
  lastAxis: 0 | 1 | null = null,
): DeviceSnapshot {
  return { keys: new Set(keys), gamepadButtons: new Map(gamepadButtons), gamepadAxes, lastAxis };
}

const keyDown = (device: DeviceSnapshot, keys: readonly string[] | undefined): boolean =>
  keys?.some((key) => device.keys.has(key)) ?? false;

function gamepadButtonValue(device: DeviceSnapshot, binding: ButtonBinding): number {
  let value = 0;
  for (const index of binding.gamepadButtons ?? []) value = Math.max(value, device.gamepadButtons.get(index) ?? 0);
  return Math.min(Math.max(value, 0), 1);
}

function axis1dValue(device: DeviceSnapshot, binding: Axis1dBinding): number {
  const keyboard = (keyDown(device, binding.positiveKeys) ? 1 : 0) - (keyDown(device, binding.negativeKeys) ? 1 : 0);
  const gamepad = binding.gamepadAxis === undefined ? 0 : (device.gamepadAxes[binding.gamepadAxis] ?? 0);
  return Math.abs(gamepad) > Math.abs(keyboard) ? gamepad : keyboard;
}

function applyDeadzone(value: number, deadzone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude < deadzone) return 0;
  return Math.sign(value) * Math.min((magnitude - deadzone) / Math.max(1 - deadzone, Number.EPSILON), 1);
}

function axis2dValue(device: DeviceSnapshot, binding: Axis2dBinding): [number, number] {
  const keyboard: [number, number] = [
    (keyDown(device, binding.rightKeys) ? 1 : 0) - (keyDown(device, binding.leftKeys) ? 1 : 0),
    (keyDown(device, binding.downKeys) ? 1 : 0) - (keyDown(device, binding.upKeys) ? 1 : 0),
  ];
  const deadzone = Math.min(Math.max(binding.gamepadDeadzone ?? 0, 0), 0.99);
  const gamepad: [number, number] = binding.gamepadAxes
    ? [
        applyDeadzone(device.gamepadAxes[binding.gamepadAxes[0]] ?? 0, deadzone),
        applyDeadzone(device.gamepadAxes[binding.gamepadAxes[1]] ?? 0, deadzone),
      ]
    : [0, 0];
  return Math.hypot(...gamepad) > Math.hypot(...keyboard) ? gamepad : keyboard;
}

function constrainAxis1d(value: number, profile: HardwareGenerationProfile): number {
  if (profile.input.directional !== 'analog') return Math.abs(value) < 0.001 ? 0 : Math.sign(value);
  return Math.min(Math.max(value, -1), 1);
}

function constrainAxis2d(
  value: [number, number],
  profile: HardwareGenerationProfile,
  binding: Axis2dBinding,
  lastAxis: 0 | 1 | null,
): [number, number] {
  if (profile.input.directional !== 'analog') {
    value[0] = Math.abs(value[0]) < 0.001 ? 0 : Math.sign(value[0]);
    value[1] = Math.abs(value[1]) < 0.001 ? 0 : Math.sign(value[1]);
  }
  if (!profile.input.allowDiagonal && value[0] !== 0 && value[1] !== 0) {
    const x = Math.abs(value[0]);
    const y = Math.abs(value[1]);
    const configured = binding.tieBreak === 'y' ? 1 : binding.tieBreak === 'last' ? (lastAxis ?? 0) : 0;
    const keep = x === y ? configured : x > y ? 0 : 1;
    value[keep === 0 ? 1 : 0] = 0;
  }
  const magnitude = Math.hypot(...value);
  if (profile.input.directional === 'analog' && magnitude > 1) {
    value[0] /= magnitude;
    value[1] /= magnitude;
  }
  return value;
}

export function createActionMap<const Definition extends ActionDefinition>(
  definition: Definition,
  bindings: ActionBindings<Definition>,
): ActionMap<Definition> {
  const buttons = new Map<keyof Definition, ButtonActionValue>();

  return {
    definition,
    sample(device, profile, dtMs = 1000 / 60): ActionSnapshot<Definition> {
      const snapshot: Partial<Record<keyof Definition, unknown>> = {};
      for (const key of Object.keys(definition) as Array<keyof Definition>) {
        const kind = definition[key];
        const binding = bindings[key];
        if (kind === 'button') {
          const previous = buttons.get(key) ?? { down: false, pressed: false, released: false, value: 0, heldMs: 0 };
          const buttonBinding = binding as ButtonBinding;
          const keyboardDown = keyDown(device, buttonBinding.keys);
          const gamepadValue = gamepadButtonValue(device, buttonBinding);
          const down = keyboardDown || gamepadValue > 0.15;
          const heldMs = down ? (previous.down ? previous.heldMs + dtMs : 0) : 0;
          const keyboardValue = keyboardDown && buttonBinding.holdRampMs
            ? Math.min(heldMs / buttonBinding.holdRampMs, 1)
            : keyboardDown ? 1 : 0;
          const analogValue = Math.max(keyboardValue, gamepadValue);
          const next: ButtonActionValue = {
            down,
            pressed: down && !previous.down,
            released: !down && previous.down,
            value: buttonBinding.requiresPressure && !profile.input.pressureSensitive
              ? 0
              : profile.input.pressureSensitive ? analogValue : down ? 1 : 0,
            heldMs,
          };
          buttons.set(key, next);
          snapshot[key] = next;
        } else if (kind === 'axis1d') {
          snapshot[key] = constrainAxis1d(axis1dValue(device, binding as Axis1dBinding), profile);
        } else {
          const axisBinding = binding as Axis2dBinding;
          snapshot[key] = constrainAxis2d(axis2dValue(device, axisBinding), profile, axisBinding, device.lastAxis);
        }
      }
      return snapshot as ActionSnapshot<Definition>;
    },
    reset: () => buttons.clear(),
  };
}
