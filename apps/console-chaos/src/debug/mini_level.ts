/**
 * 本編を遊ぶための組み立て（T0-15 で投影の検証用ミニレベルとして始まり、T1-24 で本編の器になった）。
 *
 * **描画そのものはここには無い。**
 * T1-24 で `render/renderer3d.ts`（描く側）と `gameplay/scene.ts`（何を積むか）へ移した。
 * ここに残るのは「入力ソース・セッション・描画・音の接続」だけで、
 * ファイル自体が `debug/` にあるのは呼び出し元（`main.ts` の `?scene=mini`）の都合による。
 *
 * 投影ルール・物理・パズルは `gameplay/` の本実装をそのまま使う。
 */
import type { GLContext } from '@/render/gl/index';
import { createGenerationController } from '@console-chaos/engine';
import { createPipeline, type Pipeline } from '@/render/pipeline';
import { createRenderer3d, type Renderer3d } from '@/render/renderer3d';
import type { CrtPreset, CrtQuality } from '@/render/postfx/presets';
import type { GenerationId } from '@/generation/profiles';
import { aabbFromCenter, overlaps } from '@/gameplay/projection';
import { TRANSITION_DURATION_MS } from '@/generation/transition';
import { TICK_MS, TICK_SECONDS } from '@/core/time';
import { combineRawInputs, createRawInput, type RawInput } from '@/input/mapper';
import { createKeyboardSource, type KeyboardSource } from '@/input/source_keyboard';
import { createGamepadSource, type GamepadSource } from '@/input/source_gamepad';
import type { PlayerBodyData, PlayerStateData } from '@/gameplay/player';
import { createSession, type Session } from '@/gameplay/session';
import { buildDrawables, createScene, type Scene } from '@/gameplay/scene';
import { collidersOf } from '@/level/loader';
import { PIXELS_PER_WORLD_UNIT, type LevelFile } from '@/level/schema';
import { applyScanlineLimit, type SpriteDrawItem } from '@/render/sprite_limit';
import { collectColliderBoxes, createColliderView, type ColliderBox, type ColliderView } from './collider_view';

/** 通常切替の尺。T1-03 で generation/transition.ts に一本化した */
export const SWITCH_DURATION_MS = TRANSITION_DURATION_MS.player;

/** クリアしたときにプレイヤーへ掛ける色。到達が分かるだけの最小の演出 */
const CLEARED_TINT: [number, number, number, number] = [0.45, 1.25, 0.65, 1];

export interface MiniLevelState {
  generation: GenerationId;
  crtQuality: CrtQuality;
  /** 位置・速度・接地は本実装の PlayerBody が持つ（T1-05 / T1-06） */
  body: PlayerBodyData;
  player: PlayerStateData;
  cleared: boolean;
  /** 直近の切替で安全座標へ復帰したか（デバッグ表示用） */
  recovered: boolean;
  /** 当たり判定の可視化（C キー）。既定は切 */
  showColliders: boolean;
}

export interface MiniLevel {
  readonly state: MiniLevelState;
  /** ゲーム本体。HUD（T1-18）と効果音（T1-16）が状態を読むために公開する */
  readonly session: Session;
  /** 描画コマンド。何が積まれたかを外から確かめるために公開する（計測・デバッグ用） */
  readonly scene: Scene;
  /** 直近のフレームで描いた三角形数（予算の確認用） */
  readonly triangleCount: number;
  /**
   * 直近のフレームで描いた当たり判定。表示が切れている間は空。
   * 読み上げ（`collider_hud.ts`）が同じものを文字にする
   */
  readonly colliderBoxes: readonly ColliderBox[];
  /**
   * デバッグ用の疑似入力ソース。キーボード・ゲームパッドと同じ `RawInput` の形で持ち、
   * 3 つを `combineRawInputs` でまとめる（入力ソースの追加が波及しない構造。GAME_PLAN §10.3）
   */
  readonly input: RawInput;
  switchTo(generation: GenerationId): void;
  /** 実ブラウザのキーボードへ接続する。戻り値を呼ぶと解除される */
  attach(target: EventTarget): () => void;
  tick(): void;
  draw(screenWidth: number, screenHeight: number): void;
  reset(): void;
  dispose(): void;
}

export interface MiniLevelOptions {
  /**
   * CRT プリセットの部分上書き（BR-05）。**設定そのものは UI 側の持ち物**なので、
   * `MiniLevelState` には入れず、読む手だけを受け取る（`ui/settings.ts`）
   */
  crtOverride?: () => Partial<CrtPreset>;
}

export async function createMiniLevel(
  ctx: GLContext,
  level: LevelFile,
  assets: string,
  options: MiniLevelOptions = {},
): Promise<MiniLevel> {
  // シミュレーションはゲーム本体の組み立て（gameplay/session.ts）に任せる
  const generation = createGenerationController('PS1');
  const session: Session = createSession({ level, generation });
  const playerBody = session.player;
  const scene: Scene = createScene(session);
  const renderer: Renderer3d = await createRenderer3d(ctx, {
    assets,
    drawables: buildDrawables(level),
  });
  // シェーダの事前コンパイルは createPipeline で封じられる（V7）。
  // 当たり判定の線もそれより前に用意しておく
  const colliderView: ColliderView = createColliderView(ctx);

  /** このシーンのゴール判定に使う要素（通り抜ける目標） */
  const goals = collidersOf(level).filter((entity) => entity.type === 'goal');

  const levelState: MiniLevelState = {
    generation: generation.generation,
    crtQuality: 'full',
    body: playerBody,
    player: session.playerState,
    cleared: false,
    recovered: false,
    showColliders: false,
  };
  /** 当たり判定の線。表示中だけ毎フレーム組み立て直す */
  let colliderBoxes: ColliderBox[] = [];

  // 入力は T1-04 の実装をそのまま使う（キーボード + ゲームパッド + 世代制約）
  const input: RawInput = createRawInput();
  const keyboard: KeyboardSource = createKeyboardSource();
  const gamepad: GamepadSource = createGamepadSource();

  const pipeline: Pipeline = createPipeline(ctx, {
    quality: () => levelState.crtQuality,
    ...(options.crtOverride ? { crtOverride: options.crtOverride } : {}),
  });

  function tick(): void {
    // 3 つのソースを 1 つの生入力にまとめて渡す。以降の進行順序は session が持つ
    session.prepare(combineRawInputs([keyboard.read(), gamepad.read(), input]));
    generation.advance(TICK_MS);
    session.tick();
    levelState.generation = generation.generation;

    // 走査線制限（§4.4 の段階 9）。画面 Y は描画側の計算なのでここで作る
    const video = session.profile.video;
    const halfView = video.internalHeight / (2 * PIXELS_PER_WORLD_UNIT);
    const sprites: SpriteDrawItem[] = session.sprites.map(({ entity, body }) => ({
      entity,
      y: (playerBody.position[1] + halfView - (body.position[1] + body.halfExtents[1])) * PIXELS_PER_WORLD_UNIT,
      height: body.halfExtents[1] * 2 * PIXELS_PER_WORLD_UNIT,
    }));
    session.commitCulled(
      applyScanlineLimit(sprites, video.spritesPerScanline, video.internalHeight).culled,
    );

    // このシーンのゴール判定（通り抜ける要素に触れたらクリア）
    const bodies = session.bodies();
    const box = aabbFromCenter(playerBody.position, playerBody.halfExtents);
    for (const goal of goals) {
      const body = bodies.get(goal.id);
      if (body && overlaps(box, aabbFromCenter(body.position, body.halfExtents), video.projection)) {
        levelState.cleared = true;
      }
    }

    // 世界の状態 → 描画コマンド（§4.4 の最後。ここから先は GL の話になる）
    scene.update(TICK_SECONDS);
    scene.frame.player.tint = levelState.cleared ? [...CLEARED_TINT] : [1, 1, 1, 1];
  }

  /** 切替要求。トランジション中でも受け付ける（switcher がキューに積む） */
  function switchTo(generation: GenerationId): void {
    session.generation.request(generation);
    levelState.generation = session.generation.generation;
  }

  return {
    state: levelState,
    session,
    scene,
    input,
    get triangleCount() {
      return renderer.triangleCount;
    },
    get colliderBoxes() {
      return colliderBoxes;
    },
    switchTo,
    attach: (target) => keyboard.attach(target),
    tick,
    draw(screenWidth, screenHeight): void {
      // 線はシーンと同じ経路で描く（同じカメラ・同じ内部解像度なので位置がずれない）
      colliderBoxes = levelState.showColliders ? collectColliderBoxes(session, scene.frame) : [];
      pipeline.render(
        {
          generation: generation.generation,
          from: generation.transition.active ? generation.transition.from : null,
          blend: generation.transition.blend,
          screenWidth,
          screenHeight,
          timeSeconds: scene.frame.timeSeconds,
        },
        (profile) => {
          renderer.draw(profile, scene.frame);
          if (colliderBoxes.length > 0) colliderView.draw(profile.video, scene.frame, colliderBoxes);
        },
        // スプライト面（T2-10）。持つ世代でだけ呼ばれる
        (profile) => renderer.drawSprites(profile, scene.frame),
      );
    },
    reset(): void {
      session.reset();
      levelState.cleared = false;
      levelState.recovered = false;
    },
    dispose(): void {
      pipeline.dispose();
      colliderView.dispose();
      renderer.dispose();
      session.dispose();
    },
  };
}

/**
 * 実ブラウザへの接続。移動・ジャンプ・世代切替は T1-04 の入力層が担当し、
 * ここが足すのはデバッグ専用のキー（`R` でやり直し / `C` で当たり判定表示）だけ。
 */
export function bindMiniLevelKeys(level: MiniLevel, onReset?: () => void): () => void {
  const detachInput = level.attach(window);
  const down = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    if (key === 'c') {
      level.state.showColliders = !level.state.showColliders;
      return;
    }
    if (key !== 'r') return;
    level.reset();
    onReset?.();
  };
  window.addEventListener('keydown', down);
  return () => {
    detachInput();
    window.removeEventListener('keydown', down);
  };
}
