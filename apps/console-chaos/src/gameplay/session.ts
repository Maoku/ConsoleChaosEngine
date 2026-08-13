/**
 * ゲーム本体の組み立て（T1-15）。
 *
 * **§4.4 の 1 ティックの進行順序は、ここにしか書かれていない。**
 * 描画を持たないので、ブラウザでも Vitest のヘッドレスでも同じものが動く。
 * リプレイテスト（§7.2）と実際の画面が同じ組み立てを通ることが、この形の目的。
 *
 * IMPLEMENTATION_PLAN §3 のツリーには無いファイルだが、
 * 「レベル・入力・世代・物理・パズル・チェックポイントを 1 ティックへまとめる場所」は
 * どのモジュールにも属さず、かつ複数の呼び出し元（画面・テスト）から要る。
 * §3 への追加として T1-15 で新設した。
 *
 * 段階 9（走査線制限）だけは画面の座標が要るため、
 * 結果を `commitCulled` で受け取る形にして描画側へ預けている（§4.4 の 1 ティック遅延）。
 *
 * **走査線制限は描画にだけ効く**（T2 の決定 2 で「消えたら当たり判定も消える」を廃止）。
 * `culled` を読むのは `gameplay/scene.ts` だけで、パズルには渡さない。
 */
import {
  TICK_MS,
  createSchedule,
  createWorld,
  hash32,
  type Entity,
  type GenerationController,
  type SystemSchedule,
  type World,
} from '@console-chaos/engine';
import {
  createNeutralConsoleChaosActions,
  type ConsoleChaosActionSnapshot,
} from '@/config/actions';
import { generationView, type ConsoleChaosGenerationView } from '@/config/generation';
import type { LevelEntity, LevelFile } from '@/level/schema';
import {
  advanceRespawn,
  beginRespawn,
  createCheckpointState,
  isPlayable,
  updateCheckpoints,
  type CheckpointState,
} from './checkpoint';
import {
  createHintState,
  requestHint,
  resetHints,
  updateHints,
  type HintMessage,
  type HintOptions,
  type HintState,
  type HintTarget,
} from './hints';
import { StaticBody, physicsSystem, type StaticBodyData } from './physics';
import { PlayerBody, PlayerState, playerSystem, type PlayerBodyData, type PlayerStateData } from './player';
import {
  clearGroundAnchor,
  createProjectionState,
  aabbFromCenter,
  overlaps,
  resolveSwitchTo2D,
  resolveSwitchTo3D,
  type ProjectionState,
  type Vec3,
} from './projection';
import { allPuzzles } from './puzzles/registry';
import type { PuzzleContext, PuzzleDefinition } from './puzzles/types';

/** 走査線制限の対象になるレベル要素の種別（動くもの＝スプライト） */
const SPRITE_TYPES = new Set(['enemy', 'swarm']);

/**
 * 「そのパズルに取り組んでいる」と見なす距離（メートル）。ヒントの滞在時間はこの中でだけ進む（T1-17）。
 * エリア 1 は部屋を 16m 間隔で並べてあるので、隣の部屋のパズルを数え始めない値にする。
 */
export const HINT_ENGAGE_RADIUS = 10;

export interface SessionOptions {
  level: LevelFile;
  /** GameHost 利用時は context 所有の World を注入する。ヘッドレス replay は省略できる。 */
  world?: World;
  generation: GenerationController;
  /** 出発位置の上書き（リプレイ・デバッグ用）。省略時はレベルの spawn */
  spawn?: Vec3;
  /** これより下へ落ちたら復帰する。省略時はレベルの一番下から 4m 下 */
  fallLimitY?: number;
  /** 段階的ヒント（T1-17）。既定は有効。設定で完全にオフにできる */
  hints?: HintOptions;
  /**
   * 乱数の種（T2 の決定 3）。正解ルートを持つ部屋が「試行ごとに変わる」ために使う。
   * **リプレイはこの値を記録する。**省略時は `DEFAULT_SEED`（記録のない古い経路でも再現する）
   */
  seed?: number;
}

/** 種を渡されなかったときの値。決め打ちにしておくと、種を持たない記録も再現する */
export const DEFAULT_SEED = 0x436861;

export interface SessionSprite {
  entity: Entity;
  body: StaticBodyData;
}

export interface Session {
  readonly level: LevelFile;
  readonly world: World;
  readonly player: PlayerBodyData;
  readonly playerState: PlayerStateData;
  readonly generation: GenerationController;
  readonly checkpoints: CheckpointState;
  readonly projection: ProjectionState;
  readonly entities: ReadonlyMap<string, Entity>;
  /** レベル要素の id → 現在の当たり判定（描画側が形と位置を読む） */
  bodies(): ReadonlyMap<string, StaticBodyData>;
  /** 走査線制限にかける対象（描画側が画面 Y を計算して applyScanlineLimit へ渡す） */
  readonly sprites: readonly SessionSprite[];
  readonly culled: ReadonlySet<Entity>;
  readonly solved: ReadonlySet<string>;
  /** レベル内のゴールへ到達したか。到達後は `reset()` まで保持する。 */
  readonly cleared: boolean;
  /** 段階的ヒントの状態（T1-17）。UI が `message` を読む */
  readonly hints: HintState;
  /** 今取り組んでいるパズル（近くにある未解決のもの）。無ければ null */
  readonly activePuzzleId: string | null;
  /** プレイヤーがヒントを要求した。段階を 1 つ進めて返す */
  requestHint(): HintMessage | null;
  readonly profile: ConsoleChaosGenerationView;
  readonly tickIndex: number;
  /** §4.4 の段階 3〜8。GameHost が generation を進めた後の ActionMap snapshot を受け取る。 */
  tick(actions: ConsoleChaosActionSnapshot): void;
  /** 段階 9 の結果を次ティックへ書き戻す（描画側が呼ぶ） */
  commitCulled(culled: readonly Entity[]): void;
  reset(): void;
  dispose(): void;
}

function lowestPoint(level: LevelFile): number {
  let lowest = Infinity;
  for (const sector of level.sectors) lowest = Math.min(lowest, sector.center[1] - sector.halfExtents[1]);
  return Number.isFinite(lowest) ? lowest : 0;
}

function isSprite(entity: LevelEntity): boolean {
  return SPRITE_TYPES.has(entity.type);
}

/** パズルの中心（配置された要素の平均位置）。ヒントの「近く」の判定に使う */
function puzzleCenters(level: LevelFile): Array<{ puzzleId: string; center: Vec3 }> {
  const positionById = new Map(level.entities.map((entity) => [entity.id, entity.transform.position]));
  const centers: Array<{ puzzleId: string; center: Vec3 }> = [];
  for (const placement of level.puzzles) {
    const positions = placement.entities
      .map((id) => positionById.get(id))
      .filter((position): position is [number, number, number] => position !== undefined);
    if (positions.length === 0) continue;
    const center: Vec3 = [0, 0, 0];
    for (const position of positions) {
      center[0] += position[0] / positions.length;
      center[1] += position[1] / positions.length;
      center[2] += position[2] / positions.length;
    }
    centers.push({ puzzleId: placement.puzzleId, center });
  }
  return centers;
}

function distanceSquared(a: Vec3, b: Vec3): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

export function createSession(options: SessionOptions): Session {
  const { level } = options;
  const generation = options.generation;
  const world: World = options.world ?? createWorld();
  const entities = new Map<string, Entity>();
  const bodyById = new Map<string, StaticBodyData>();
  const sprites: SessionSprite[] = [];

  for (const entity of level.entities) {
    if (!entity.collider) continue;
    const id = world.create();
    const body = world.add(id, StaticBody, {
      position: [...entity.transform.position] as Vec3,
      halfExtents: [...entity.collider.halfExtents] as Vec3,
      solid: entity.collider.solid !== false,
    });
    entities.set(entity.id, id);
    bodyById.set(entity.id, body);
    if (isSprite(entity)) sprites.push({ entity: id, body });
  }

  const spawn: Vec3 = [...(options.spawn ?? level.spawn.position)] as Vec3;
  const startGeneration = generation.generation;
  const fallLimitY = options.fallLimitY ?? lowestPoint(level) - 4;

  const playerEntity = world.create();
  const player: PlayerBodyData = world.add(playerEntity, PlayerBody);
  player.position = [...spawn] as Vec3;
  const playerState: PlayerStateData = world.add(playerEntity, PlayerState);

  const projection: ProjectionState = createProjectionState(generation.profile.video.projection);
  projection.safePosition = [...spawn] as Vec3;

  const checkpoints: CheckpointState = createCheckpointState(spawn);
  /** Z 吸着の状態（§5.5.3）。切替時に決まり、トランジションの尺で消化する */
  const slide: { z: ((progress: number) => number) | null; y: number | null } = { z: null, y: null };
  let frame = {
    snapshot: createNeutralConsoleChaosActions(),
    profile: generationView(startGeneration),
  };

  const disconnectGeneration = generation.onBeforeSwitch((event) => {
    slide.z = null;
    slide.y = null;
    if (event.fromProfile.video.projection === event.toProfile.video.projection) return;

    if (event.toProfile.video.projection === 'ortho2d') {
      // 3D → 2D：Z を無視した結果のめり込みを解消する
      const solids = [...bodyById.values()]
        .filter((body) => body.solid)
        .map((body) => aabbFromCenter(body.position, body.halfExtents));
      const result = resolveSwitchTo2D(
        aabbFromCenter(player.position, player.halfExtents),
        solids,
        projection.safePosition,
      );
      player.position = result.position;
      if (result.usedSafePosition) player.velocity = [0, 0, 0];
    } else {
      // 2D → 3D：接地していれば Z を接地面へ吸着させる
      const resolution = resolveSwitchTo3D(player.position, projection.anchor, player.grounded, event.durationMs);
      if (resolution.targetZ !== null) {
        slide.z = (progress) => resolution.zAt(progress);
        slide.y = player.position[1];
      }
    }
  });

  const schedule: SystemSchedule = createSchedule();
  schedule.add('gameplay', 'player', playerSystem(() => frame));
  schedule.add(
    'physics',
    'bodies',
    physicsSystem(() => ({ mode: frame.profile.hardware.video.projection, projection }), () => [player]),
  );

  const puzzles: PuzzleDefinition[] = allPuzzles();
  const solved = new Set<string>();
  const goals = level.entities.filter((entity) => entity.type === 'goal' && entity.collider !== undefined);
  let cleared = false;

  // ヒントの対象と文面はレベルデータから作る（T1-17。文面に世代を直書きしない）
  const hintTargets: HintTarget[] = level.puzzles.map((placement) => ({
    puzzleId: placement.puzzleId,
    generations: placement.requiredGenerations,
  }));
  const hints: HintState = createHintState(hintTargets, options.hints);
  const centers = puzzleCenters(level);
  let activePuzzleId: string | null = null;

  let culled: ReadonlySet<Entity> = new Set<Entity>();
  let tickIndex = 0;

  const seed = options.seed ?? DEFAULT_SEED;
  /** パズルごとの覚え書き。`reset()` で捨てる */
  const memories = new Map<string, Map<string, number>>();

  const contexts = new Map<string, PuzzleContext>();
  for (const puzzle of puzzles) {
    const memory = new Map<string, number>();
    memories.set(puzzle.id, memory);
    contexts.set(puzzle.id, {
      world,
      profile: generationView(startGeneration),
      entities,
      player,
      memory,
      get tickIndex() {
        return tickIndex;
      },
      // 復帰するたびに変わる。落ちてやり直せば正解ルートも変わる（決定 3）
      get attemptSeed() {
        return hash32(seed, checkpoints.respawnCount);
      },
      markSolved: () => solved.add(puzzle.id),
      get solved() {
        return solved.has(puzzle.id);
      },
    });
  }

  /**
   * 今どのパズルの前にいるか。未解決のもののうち最も近く、
   * `HINT_ENGAGE_RADIUS` の内側にあるものを 1 つ選ぶ（同距離なら配置順で先のもの）。
   */
  function nearestUnsolvedPuzzle(): string | null {
    let best: string | null = null;
    let bestDistance = HINT_ENGAGE_RADIUS ** 2;
    for (const { puzzleId, center } of centers) {
      if (solved.has(puzzleId)) continue;
      const distance = distanceSquared(player.position, center);
      if (distance < bestDistance) {
        best = puzzleId;
        bestDistance = distance;
      }
    }
    return best;
  }

  function tick(actions: ConsoleChaosActionSnapshot): void {
    const profile = generationView(generation.generation);
    const snapshot = isPlayable(checkpoints) ? actions : createNeutralConsoleChaosActions();
    projection.mode = profile.hardware.video.projection;
    frame = { snapshot, profile };

    // 段階 4・5：プレイヤーの意図 → 物理
    schedule.run(world, tickIndex);

    // Z 吸着は物理の結果を上書きする（吸着の途中で落ちないように）
    if (slide.z) {
      player.position[2] = slide.z(generation.transition.blend);
      if (slide.y !== null) {
        player.position[1] = slide.y;
        player.velocity[1] = 0;
        player.grounded = true;
      }
      if (!generation.transition.active) {
        slide.z = null;
        slide.y = null;
      }
    }
    if (!player.grounded && player.velocity[1] > 0) clearGroundAnchor(projection);

    // 段階 6：トリガ・パズル・チェックポイント
    for (const puzzle of puzzles) {
      const ctx = contexts.get(puzzle.id)!;
      ctx.profile = profile;
      puzzle.update(ctx);
    }
    updateCheckpoints(checkpoints, level.checkpoints, player.position, player.halfExtents, projection.mode);

    // ヒント（T1-17）。取り組んでいるパズルの滞在時間だけが進む
    activePuzzleId = nearestUnsolvedPuzzle();
    updateHints(hints, { activePuzzleId, solved, dtMs: TICK_MS });

    if (player.position[1] < fallLimitY) beginRespawn(checkpoints);
    const target = advanceRespawn(checkpoints);
    if (target) {
      player.position = [...target.position] as Vec3;
      player.velocity = [...target.velocity] as Vec3;
      player.grounded = false;
      projection.safePosition = [...target.position] as Vec3;
      clearGroundAnchor(projection);
    }

    // ゴールは通り抜けるトリガ。移動と復帰が確定した後の位置で判定し、
    // クリア画面が次の固定更新から世界を止められるよう状態を保持する。
    const playerBox = aabbFromCenter(player.position, player.halfExtents);
    for (const goal of goals) {
      const body = bodyById.get(goal.id);
      if (body && overlaps(playerBox, aabbFromCenter(body.position, body.halfExtents), projection.mode)) {
        cleared = true;
        break;
      }
    }

    tickIndex++;
  }

  return {
    level,
    world,
    player,
    playerState,
    generation,
    checkpoints,
    projection,
    entities,
    sprites,
    bodies: () => bodyById,
    get culled() {
      return culled;
    },
    get solved() {
      return solved;
    },
    get cleared() {
      return cleared;
    },
    hints,
    get activePuzzleId() {
      return activePuzzleId;
    },
    requestHint: () => requestHint(hints, activePuzzleId),
    get profile() {
      return generationView(generation.generation);
    },
    get tickIndex() {
      return tickIndex;
    },
    tick,
    commitCulled(next): void {
      culled = new Set(next);
    },
    reset(): void {
      player.position = [...spawn] as Vec3;
      player.velocity = [0, 0, 0];
      player.grounded = false;
      player.wallDirection = 0;
      solved.clear();
      cleared = false;
      for (const memory of memories.values()) memory.clear();
      checkpoints.active = [...spawn] as Vec3;
      checkpoints.reached.length = 0;
      checkpoints.phase = 'playing';
      checkpoints.remainingTicks = 0;
      projection.safePosition = [...spawn] as Vec3;
      clearGroundAnchor(projection);
      resetHints(hints);
      activePuzzleId = null;
    },
    dispose(): void {
      disconnectGeneration();
    },
  };
}
