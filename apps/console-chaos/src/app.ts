import {
  GENERATION_IDS,
  validateSceneReferences,
  type ActionSnapshot,
  type GameModule,
  type RenderFrame,
} from '@console-chaos/engine';
import { createConsoleChaosActionMap, type CONSOLE_CHAOS_ACTIONS } from '@/config/actions';
import { adaptConsoleChaosLevel } from '@/content/level-adapter';
import { createRawInput, type RawInput } from '@/input/mapper';
import type { LevelFile } from '@/level/schema';
import { createSession } from '@/gameplay/session';

type ConsoleActions = ActionSnapshot<typeof CONSOLE_CHAOS_ACTIONS>;

function inputFor(actions: ConsoleActions): RawInput {
  const input = createRawInput();
  input.move[0] = actions.move[0];
  input.move[1] = actions.move[1];
  input.fine = actions.fine.down;
  input.jump = actions.jump.down;
  input.action = actions.action.down;
  input.subAction = actions.subAction.down;
  input.pressureButton = actions.pressure.down;
  input.pressureAnalog = actions.pressure.value;
  input.switchCycle = actions.switchPrevious.pressed ? -1 : actions.switchNext.pressed ? 1 : 0;
  const direct = [actions.switch1, actions.switch2, actions.switch3, actions.switch4]
    .findIndex((button) => button.pressed);
  input.switchTo = direct < 0 ? null : (GENERATION_IDS[direct] ?? null);
  return input;
}

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
        generation: context.generation.generation,
      });
      return {
        fixedUpdate({ dtMs }): void {
          const snapshot = actions.sample(context.input.snapshot, context.generation.profile, dtMs);
          const raw = inputFor(snapshot);
          if (raw.switchCycle !== 0) context.generation.cycle(raw.switchCycle);
          if (raw.switchTo) context.generation.request(raw.switchTo);
          session.tick(raw);
        },
        buildRenderFrame(frame: RenderFrame): void {
          const profile = session.profile;
          frame.camera = {
            projection: profile.video.projection === 'ortho2d' ? 'orthographic' : 'perspective',
            position: [session.player.position[0], 18, session.player.position[2]],
            target: session.player.position,
            zoom: 16,
          };
          frame.backgrounds.push({ color: '#22405a' });
          frame.sprites.push({
            id: 'player',
            position: session.player.position,
            size: [session.player.halfExtents[0] * 2, session.player.halfExtents[2] * 2],
            color: '#f4dc7a',
          });
        },
        dispose(): void {
          actions.reset();
          session.world.clear();
        },
      };
    },
  };
}
