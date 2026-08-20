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
import { createConsoleChaosPresentation, type ConsoleChaosPresentation } from '@/presentation/frame';
import { createConsoleAudioPresenter } from '@/audio/presenter';
import type { ConsoleAudioPresenter } from '@/audio/presenter';
import { createCueTracker, pollCues } from '@/gameplay/audio_cues';
import { songOf } from '@/audio/songs';
import type { Session } from '@/gameplay/session';
import type { Score } from '@console-chaos/engine';
import type { ConsoleChaosActionSnapshot } from '@/config/actions';

export interface ConsoleChaosModuleHooks {
  initialSong?: Score;
  onCreate?(session: Session, audio: ConsoleAudioPresenter, presentation: ConsoleChaosPresentation): void;
  /** false の間は入力・世代切替・ゲーム世界の固定更新を止め、描画だけを続ける。 */
  shouldSimulate?(session: Session): boolean;
  /** 通常入力を、デモなどが作る同じ action snapshot 経路へ差し替える。 */
  overrideActions?(
    session: Session,
    sampled: ConsoleChaosActionSnapshot,
  ): ConsoleChaosActionSnapshot;
  onFixedUpdate?(session: Session): void;
  onRender?(session: Session, presentation: ConsoleChaosPresentation): void;
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
      const audio = createConsoleAudioPresenter(context.audio, hooks.initialSong ?? songOf(null).score);
      const presentation = createConsoleChaosPresentation(level);
      const cues = createCueTracker();
      audio.start(context.generation.profile);
      const disconnectAudio = context.events.on('generationSwitch', (event) => {
        audio.applyGeneration(event.toProfile);
      });
      hooks.onCreate?.(session, audio, presentation);
      let snapshot = createNeutralConsoleChaosActions();
      let simulate = true;
      return {
        prepareFixedUpdate({ dtMs }): void {
          simulate = hooks.shouldSimulate?.(session) ?? true;
          if (!simulate) {
            actions.reset();
            snapshot = createNeutralConsoleChaosActions();
            return;
          }
          const sampled = actions.sample(context.input.snapshot, context.generation.profile, dtMs);
          snapshot = hooks.overrideActions?.(session, sampled) ?? sampled;
          if (snapshot.switchPrevious.pressed) context.generation.cycle(-1);
          if (snapshot.switchNext.pressed) context.generation.cycle(1);
          const direct = [snapshot.switch1, snapshot.switch2, snapshot.switch3, snapshot.switch4]
            .findIndex((button) => button.pressed);
          if (direct >= 0) {
            context.generation.request(GENERATION_IDS[direct] ?? context.generation.generation);
          }
        },
        fixedUpdate(): void {
          if (!simulate) return;
          session.tick(snapshot);
          presentation.fixedUpdate(session);
          for (const cue of pollCues(cues, session)) audio.playSfx(cue, context.generation.profile);
          hooks.onFixedUpdate?.(session);
        },
        buildRenderFrame(frame: RenderFrame): void {
          presentation.build(frame, session, context);
          hooks.onRender?.(session, presentation);
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
