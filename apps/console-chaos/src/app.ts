import {
  GENERATION_IDS,
  validateSceneReferences,
  type GameModule,
  type RenderFrame,
} from '@console-chaos/engine';
import {
  createConsoleChaosActionMap,
  createNeutralConsoleChaosActions,
} from '@/config/actions';
import { adaptConsoleChaosLevel } from '@/content/level-adapter';
import type { LevelFile } from '@/level/schema';
import { createSession } from '@/gameplay/session';
import { buildConsoleChaosFrame } from '@/presentation/frame';
import { createConsoleAudioPresenter } from '@/audio/presenter';
import { createCueTracker, pollCues } from '@/gameplay/audio_cues';
import { songOf } from '@/audio/songs';
import type { Session } from '@/gameplay/session';

export interface ConsoleChaosModuleHooks {
  onCreate?(session: Session): void;
  onFixedUpdate?(session: Session): void;
  onRender?(session: Session): void;
  onDispose?(session: Session): void;
}

/** Console Chaos の決定的セッションと presentation を engine lifecycle へ載せる。 */
export function createConsoleChaosModule(level: LevelFile, hooks: ConsoleChaosModuleHooks = {}): GameModule {
  return {
    id: 'console-chaos',
    async create(context) {
      const actions = createConsoleChaosActionMap();
      const scene = adaptConsoleChaosLevel(level);
      const sceneIssues = validateSceneReferences(scene);
      if (sceneIssues.length > 0) {
        throw new Error(`Console Chaos scene has ${sceneIssues.length} invalid reference(s)`);
      }
      const session = createSession({
        level,
        world: context.world,
        generation: context.generation,
      });
      const audio = createConsoleAudioPresenter(context.audio, songOf(null).score);
      const cues = createCueTracker();
      audio.start(context.generation.profile);
      const disconnectAudio = context.events.on('generationSwitch', (event) => {
        audio.applyGeneration(event.toProfile);
      });
      hooks.onCreate?.(session);
      let snapshot = createNeutralConsoleChaosActions();
      return {
        prepareFixedUpdate({ dtMs }): void {
          snapshot = actions.sample(context.input.snapshot, context.generation.profile, dtMs);
          if (snapshot.switchPrevious.pressed) context.generation.cycle(-1);
          if (snapshot.switchNext.pressed) context.generation.cycle(1);
          const direct = [snapshot.switch1, snapshot.switch2, snapshot.switch3, snapshot.switch4]
            .findIndex((button) => button.pressed);
          if (direct >= 0) {
            context.generation.request(GENERATION_IDS[direct] ?? context.generation.generation);
          }
        },
        fixedUpdate(): void {
          session.tick(snapshot);
          for (const cue of pollCues(cues, session)) audio.playSfx(cue, context.generation.profile);
          hooks.onFixedUpdate?.(session);
        },
        buildRenderFrame(frame: RenderFrame): void {
          buildConsoleChaosFrame(frame, session, level, context);
          hooks.onRender?.(session);
        },
        dispose(): void {
          actions.reset();
          disconnectAudio();
          hooks.onDispose?.(session);
          session.dispose();
        },
      };
    },
  };
}
