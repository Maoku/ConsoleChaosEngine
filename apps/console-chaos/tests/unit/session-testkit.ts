import {
  GENERATION_IDS,
  createDeviceSnapshot,
  createGenerationController,
  type DeviceSnapshot,
  type GenerationId,
} from '@console-chaos/engine';
import {
  createConsoleChaosActionMap,
  type ConsoleChaosActionSnapshot,
} from '@/config/actions';
import { createSession, type Session, type SessionOptions } from '@/gameplay/session';

export interface TestActionInput {
  move: readonly [number, number];
  fine: boolean;
  jump: boolean;
  action: boolean;
  subAction: boolean;
  pressureAnalog: number;
  pressureButton: boolean;
  switchTo: GenerationId | null;
  switchCycle: -1 | 0 | 1;
  lastAxis: 0 | 1 | null;
}

export type StandaloneSessionOptions = Omit<SessionOptions, 'generation'> & {
  generation?: GenerationId;
};

const maps = new WeakMap<Session, ReturnType<typeof createConsoleChaosActionMap>>();

export function createTestSession(options: StandaloneSessionOptions): Session {
  const session = createSession({
    ...options,
    generation: createGenerationController(options.generation ?? 'PS1'),
  });
  maps.set(session, createConsoleChaosActionMap());
  return session;
}

function encodedAxis(value: number): number {
  if (value === 0) return 0;
  return Math.sign(value) * (0.25 + Math.min(Math.abs(value), 1) * 0.75);
}

export function deviceSnapshotForInput(input: Partial<TestActionInput> = {}): DeviceSnapshot {
  const keys = new Set<string>();
  if (input.fine) keys.add('ShiftLeft');
  if (input.pressureButton) keys.add('KeyL');
  if (input.switchCycle === -1) keys.add('KeyQ');
  if (input.switchCycle === 1) keys.add('KeyE');
  if (input.switchTo) keys.add(`Digit${GENERATION_IDS.indexOf(input.switchTo) + 1}`);
  const buttons: Array<readonly [number, number]> = [];
  if (input.jump) buttons.push([0, 1]);
  if (input.action) buttons.push([2, 1]);
  if (input.subAction) buttons.push([3, 1]);
  if (input.pressureAnalog) buttons.push([7, input.pressureAnalog]);
  const move = input.move ?? [0, 0];
  return createDeviceSnapshot(
    keys,
    buttons,
    [encodedAxis(move[0]), encodedAxis(move[1])],
    input.lastAxis ?? null,
  );
}

export function sampleActions(
  map: ReturnType<typeof createConsoleChaosActionMap>,
  generation: GenerationId,
  input: Partial<TestActionInput> = {},
  dtMs = 1000 / 60,
): ConsoleChaosActionSnapshot {
  const controller = createGenerationController(generation);
  return map.sample(deviceSnapshotForInput(input), controller.profile, dtMs);
}

export function tickSession(session: Session, input: Partial<TestActionInput> | null): void {
  const map = maps.get(session);
  if (!map) throw new Error('Session was not created by createTestSession');
  const snapshot = map.sample(deviceSnapshotForInput(input ?? {}), session.generation.profile, 1000 / 60);
  if (snapshot.switchPrevious.pressed) session.generation.cycle(-1);
  if (snapshot.switchNext.pressed) session.generation.cycle(1);
  const direct = [snapshot.switch1, snapshot.switch2, snapshot.switch3, snapshot.switch4]
    .findIndex((button) => button.pressed);
  if (direct >= 0) session.generation.request(GENERATION_IDS[direct] ?? session.generation.generation);
  session.generation.advance(1000 / 60);
  session.tick(snapshot);
}
