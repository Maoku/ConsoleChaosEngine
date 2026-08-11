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
}

export interface ButtonBinding {
  keys?: readonly string[];
  gamepadButtons?: readonly number[];
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
): DeviceSnapshot {
  return { keys: new Set(keys), gamepadButtons: new Map(gamepadButtons), gamepadAxes };
}

const keyDown = (device: DeviceSnapshot, keys: readonly string[] | undefined): boolean =>
  keys?.some((key) => device.keys.has(key)) ?? false;

function buttonValue(device: DeviceSnapshot, binding: ButtonBinding): number {
  let value = keyDown(device, binding.keys) ? 1 : 0;
  for (const index of binding.gamepadButtons ?? []) value = Math.max(value, device.gamepadButtons.get(index) ?? 0);
  return Math.min(Math.max(value, 0), 1);
}

function axis1dValue(device: DeviceSnapshot, binding: Axis1dBinding): number {
  const keyboard = (keyDown(device, binding.positiveKeys) ? 1 : 0) - (keyDown(device, binding.negativeKeys) ? 1 : 0);
  const gamepad = binding.gamepadAxis === undefined ? 0 : (device.gamepadAxes[binding.gamepadAxis] ?? 0);
  return Math.abs(gamepad) > Math.abs(keyboard) ? gamepad : keyboard;
}

function axis2dValue(device: DeviceSnapshot, binding: Axis2dBinding): [number, number] {
  const keyboard: [number, number] = [
    (keyDown(device, binding.rightKeys) ? 1 : 0) - (keyDown(device, binding.leftKeys) ? 1 : 0),
    (keyDown(device, binding.downKeys) ? 1 : 0) - (keyDown(device, binding.upKeys) ? 1 : 0),
  ];
  const gamepad: [number, number] = binding.gamepadAxes
    ? [device.gamepadAxes[binding.gamepadAxes[0]] ?? 0, device.gamepadAxes[binding.gamepadAxes[1]] ?? 0]
    : [0, 0];
  return Math.hypot(...gamepad) > Math.hypot(...keyboard) ? gamepad : keyboard;
}

function constrainAxis1d(value: number, profile: HardwareGenerationProfile): number {
  if (profile.input.directional !== 'analog') return Math.abs(value) < 0.001 ? 0 : Math.sign(value);
  return Math.min(Math.max(value, -1), 1);
}

function constrainAxis2d(value: [number, number], profile: HardwareGenerationProfile): [number, number] {
  if (profile.input.directional !== 'analog') {
    value[0] = Math.abs(value[0]) < 0.001 ? 0 : Math.sign(value[0]);
    value[1] = Math.abs(value[1]) < 0.001 ? 0 : Math.sign(value[1]);
  }
  if (!profile.input.allowDiagonal && value[0] !== 0 && value[1] !== 0) {
    if (Math.abs(value[0]) >= Math.abs(value[1])) value[1] = 0;
    else value[0] = 0;
  }
  const magnitude = Math.hypot(...value);
  if (magnitude > 1) {
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
          const value = buttonValue(device, binding as ButtonBinding);
          const down = value > 0.15;
          const next: ButtonActionValue = {
            down,
            pressed: down && !previous.down,
            released: !down && previous.down,
            value: profile.input.pressureSensitive ? value : down ? 1 : 0,
            heldMs: down ? (previous.down ? previous.heldMs + dtMs : 0) : 0,
          };
          buttons.set(key, next);
          snapshot[key] = next;
        } else if (kind === 'axis1d') {
          snapshot[key] = constrainAxis1d(axis1dValue(device, binding as Axis1dBinding), profile);
        } else {
          snapshot[key] = constrainAxis2d(axis2dValue(device, binding as Axis2dBinding), profile);
        }
      }
      return snapshot as ActionSnapshot<Definition>;
    },
    reset: () => buttons.clear(),
  };
}

