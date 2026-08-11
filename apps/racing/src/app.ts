import {
  GENERATION_IDS,
  type ButtonActionValue,
  type GameModule,
} from '@console-chaos/engine';
import { createRacingActionMap } from './config/actions';
import { buildRacingFrame } from './presentation/frame';
import { createRaceState, restartRace, updateRace } from './gameplay/race';

const pressed = (button: ButtonActionValue): boolean => button.pressed;

export const RACING_GAME_MODULE: GameModule = {
  id: 'channel-circuit',
  async create(context) {
    const actions = createRacingActionMap();
    const state = createRaceState();

    return {
      fixedUpdate({ dtMs }): void {
        const input = actions.sample(context.input.snapshot, context.generation.profile, dtMs);
        if (pressed(input.switchPrevious)) context.generation.cycle(-1);
        if (pressed(input.switchNext)) context.generation.cycle(1);
        const direct = [input.switch1, input.switch2, input.switch3, input.switch4].findIndex(pressed);
        if (direct >= 0) context.generation.request(GENERATION_IDS[direct] ?? context.generation.generation);

        const events = updateRace(state, {
          steer: input.steer,
          accelerate: input.accelerate.value,
          brake: input.brake.value,
        }, pressed(input.reset));
        for (const event of events) {
          if (event === 'countdown') context.audio.playTone(440, 0.08);
          else if (event === 'start') context.audio.playTone(880, 0.18);
          else if (event === 'lap') context.audio.playTone(660, 0.12);
          else context.audio.playTone(990, 0.4);
        }
      },
      buildRenderFrame(frame): void {
        buildRacingFrame(frame, state, context);
      },
      dispose(): void {
        actions.reset();
        restartRace(state);
      },
    };
  },
};

