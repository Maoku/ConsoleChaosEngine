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

/**
 * Console Chaos の決定的セッションを engine lifecycle へ載せるアダプタ。
 * 現行 WebGL 表示は parity を守るため段階移行中も `main.ts` が担当する。
 */
export function createConsoleChaosModule(level: LevelFile): GameModule {
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
        },
        buildRenderFrame(frame: RenderFrame): void {
          buildConsoleChaosFrame(frame, session, level, context);
        },
        dispose(): void {
          actions.reset();
          session.dispose();
        },
      };
    },
  };
}
