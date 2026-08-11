import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  createDeviceSnapshot,
  createGameHost,
  createNullAudioService,
} from '@console-chaos/engine';
import {
  createManualLoopHost,
  createMutableInputSource,
  createRecordingAudioService,
  createRecordingRenderer,
} from '@console-chaos/engine-testkit';
import { describe, expect, it } from 'vitest';
import { createRacingGameModule } from '@racing/app';
import { createRacingActionMap } from '@racing/config/actions';
import { createRaceState, restartRace, updateRace, type RaceState } from '@racing/gameplay/race';

const digitFor = (generation: (typeof GENERATION_IDS)[number]): string => `Digit${GENERATION_IDS.indexOf(generation) + 1}`;

describe('Racing renewal integration QA', () => {
  it('completes and restarts a three-lap deterministic race for every presentation generation', () => {
    for (const generation of GENERATION_IDS) {
      const state = createRaceState();
      while (state.phase === 'countdown') updateRace(state, { steer: 0, accelerate: 0, brake: 0 });
      let finishSeen = false;
      for (let circuit = 0; circuit < 4; circuit++) {
        for (let index = 0; index < state.track.points.length; index++) {
          if (state.phase === ('finished' as RaceState['phase'])) break;
          const point = state.track.points[index] ?? state.track.start;
          const next = state.track.points[(index + 1) % state.track.points.length] ?? point;
          state.player.car.position = [point[0], point[1]];
          state.player.car.heading = Math.atan2(next[1] - point[1], next[0] - point[0]);
          state.player.car.speed = 8;
          const events = updateRace(state, { steer: 0, accelerate: 0, brake: 0 });
          finishSeen ||= events.includes('finish');
        }
      }
      expect(state.phase, `${generation} did not finish`).toBe('finished');
      expect(state.player.laps.lap).toBe(3);
      expect(state.resultTime).not.toBeNull();
      expect(finishSeen).toBe(true);
      restartRace(state);
      expect(state).toMatchObject({ phase: 'countdown', tick: 0, rank: 1, resultTime: null });
    }
  });

  it('preserves one RaceState and audio phase through all twelve directed switches', async () => {
    for (const from of GENERATION_IDS) {
      for (const to of GENERATION_IDS) {
        if (from === to) continue;
        const loopHost = createManualLoopHost();
        const input = createMutableInputSource();
        const renderer = createRecordingRenderer();
        const audio = createRecordingAudioService(132);
        const capture: { state?: RaceState } = {};
        const host = createGameHost({ loopHost, input, renderer, audio, initialGeneration: from });
        await host.initialize(createRacingGameModule({
          onCreate(created) {
            capture.state = created;
            created.phase = 'finished';
            created.resultTime = 12.5;
            created.player.car.speed = 9;
          },
        }));
        host.frame(0);
        const identity = capture.state;
        if (!identity) throw new Error('Racing state hook did not run');
        const stable = structuredClone(identity.player.car);
        const bar = audio.barPosition;
        input.set(createDeviceSnapshot([digitFor(to)]));
        host.frame(17);
        expect(host.context.generation.generation).toBe(to);
        expect(capture.state).toBe(identity);
        expect(capture.state?.player.car).toEqual(stable);
        expect(Math.abs(audio.barPosition - bar)).toBeLessThanOrEqual(1e-9);
        expect(renderer.frames.at(-1)).toMatchObject({ rasterSurfaces: 1, affineSurfaces: 1 });
        host.dispose();
        expect(host.context.assets.activeCount).toBe(0);
        expect(host.context.events.listenerCount('generationSwitch')).toBe(0);
      }
    }
  });

  it('survives ten restarts, two generation round-trips, and null audio disposal', async () => {
    const input = createMutableInputSource();
    const renderer = createRecordingRenderer();
    const host = createGameHost({
      loopHost: createManualLoopHost(),
      input,
      renderer,
      audio: createNullAudioService(132),
      initialGeneration: 'FC',
    });
    const capture: { state?: RaceState } = {};
    await host.initialize(createRacingGameModule({ onCreate: (created) => { capture.state = created; } }));
    let time = 0;
    host.frame(time);
    for (let restart = 0; restart < 10; restart++) {
      input.set(createDeviceSnapshot(['KeyR']));
      host.frame(time += 17);
      input.set(createDeviceSnapshot());
      host.frame(time += 17);
      expect(capture.state?.phase).toBe('countdown');
    }
    for (let round = 0; round < 2; round++) {
      for (const generation of GENERATION_IDS) {
        input.set(createDeviceSnapshot([digitFor(generation)]));
        host.frame(time += 17);
        input.set(createDeviceSnapshot());
        for (let transitionFrame = 0; transitionFrame < 70; transitionFrame++) host.frame(time += 17);
        expect(host.context.generation.generation).toBe(generation);
      }
    }
    host.dispose();
    expect(host.context.assets.activeCount).toBe(0);
    expect(host.context.events.listenerCount('generationSwitch')).toBe(0);
  });

  it('maps keyboard and gamepad racing controls through capability profiles', () => {
    const keyboard = createRacingActionMap().sample(
      createDeviceSnapshot(['ArrowLeft', 'ArrowUp', 'Digit4']),
      HARDWARE_GENERATION_PROFILES.FC,
      17,
    );
    expect(keyboard.steer).toBe(-1);
    expect(keyboard.accelerate.down).toBe(true);
    expect(keyboard.switch4.pressed).toBe(true);
    const gamepad = createRacingActionMap().sample(
      createDeviceSnapshot([], [[7, 0.8], [6, 0.35]], [0.42]),
      HARDWARE_GENERATION_PROFILES.PS2,
      17,
    );
    expect(gamepad.steer).toBeCloseTo(0.42);
    expect(gamepad.accelerate.value).toBeCloseTo(0.8);
    expect(gamepad.brake.value).toBeCloseTo(0.35);
  });
});
