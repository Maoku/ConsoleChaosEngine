import {
  GENERATION_IDS,
  type GenerationId,
  type ActionSnapshot,
  type ButtonActionValue,
  type GameModule,
} from '@console-chaos/engine';
import { createRacingAudioPresenter } from './audio/presenter';
import { createRacingActionMap, type RacingActionDefinition } from './config/actions';
import { RACING_MASTER_SCORE } from './content/audio/score';
import { createRacingPresentation } from './presentation/frame';
import { createRaceState, restartRace, updateRace, type RaceEvent, type RaceState } from './gameplay/race';

const pressed = (button: ButtonActionValue): boolean => button.pressed;

export interface RacingModuleHooks {
  onCreate?(state: RaceState, generation: GenerationId): void;
  onFixedUpdate?(state: RaceState, generation: GenerationId, events: readonly RaceEvent[]): void;
  onDispose?(state: RaceState): void;
}

export function createRacingGameModule(hooks: RacingModuleHooks = {}): GameModule {
  return {
    id: 'channel-circuit',
    async create(context) {
      const actions = createRacingActionMap();
      const state = createRaceState();
      const presentation = createRacingPresentation();
      const audio = createRacingAudioPresenter(context.audio, RACING_MASTER_SCORE);
      let input: ActionSnapshot<RacingActionDefinition> | null = null;
      audio.start(context.generation.profile);
      const disconnectAudio = context.events.on('generationSwitch', (event) => {
        audio.applyGeneration(event.toProfile);
      });
      hooks.onCreate?.(state, context.generation.generation);

      return {
        prepareFixedUpdate({ dtMs }): void {
          input = actions.sample(context.input.snapshot, context.generation.profile, dtMs);
          if (pressed(input.switchPrevious)) context.generation.cycle(-1);
          if (pressed(input.switchNext)) context.generation.cycle(1);
          const direct = [input.switch1, input.switch2, input.switch3, input.switch4].findIndex(pressed);
          if (direct >= 0) context.generation.request(GENERATION_IDS[direct] ?? context.generation.generation);
        },
        fixedUpdate(): void {
          if (!input) return;
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
          hooks.onFixedUpdate?.(state, context.generation.generation, events);
        },
        buildRenderFrame(frame): void {
          presentation.build(frame, state);
        },
        dispose(): void {
          actions.reset();
          disconnectAudio();
          hooks.onDispose?.(state);
          restartRace(state);
        },
      };
    },
  };
}

export const RACING_GAME_MODULE: GameModule = createRacingGameModule();
