/**
 * パズル定義（IMPLEMENTATION_PLAN §7.3、T1-07 で型 / T1-09〜14 で実装）。
 *
 * **`solvableIn` を必ず実装させることが、この型の目的。**
 * CI が 4 世代すべてで評価し、レベル側の `requiredGenerations` と一致するかを検査する
 *（§7.3「本作で最も価値のある自動検証」）。「タグ付けされた世代でのみ解ける」を
 * 人間のレビューに任せない。
 *
 * `solvableIn` は**プロファイルの値だけで判断する**。世代 ID で分岐すると、
 * 「なぜその世代で解けるのか」がコードから読めなくなる（不変条件 I2）。
 * 例：色が潰れることを利用するパズルなら `profile.video.paletteMode` を見る。
 *
 * **`update` は `solvableIn` と矛盾してはならない。** 宣言した世代以外で
 * 総当たりで解けてしまうなら、その宣言は嘘になる。したがって各パズルの
 * `update` は「解けた」を宣言する前に自分の成立条件を確認する。
 */
import type { GenerationProfile } from '@/generation/profiles';
import type { Entity, World } from '@/core/ecs/world';
import { StaticBody, type StaticBodyData } from '@/gameplay/physics';
import { aabbFromCenter, overlaps, type AABB, type ProjectionMode, type Vec3 } from '@/gameplay/projection';
import type { PlayerBodyData } from '@/gameplay/player';

export interface PuzzleContext {
  world: World;
  profile: GenerationProfile;
  /** レベルデータの id → 実体（レベルを読み込んだ側が作る） */
  entities: ReadonlyMap<string, Entity>;
  player: PlayerBodyData;
  /** 現在のティック番号。時間で動く仕掛けはここから決定的に出す（不変条件 I4） */
  readonly tickIndex: number;
  /**
   * 試行の種（T2-02 の決定 3）。**セッションの種 × 復帰回数**から作られ、
   * 落ちてやり直すたびに変わる。正解ルートを持つ部屋（F-2 / P2-1）が
   * 「覚えて解く」を成立させないために使う。
   *
   * リプレイはセッションの種を記録するので、同じ記録からは同じ値が出る。
   */
  readonly attemptSeed: number;
  /**
   * セッションごとの覚え書き（F-1 の「切れているツタ」など）。
   * **パズル定義は単票（モジュール読み込み時に 1 つ作られる）なので、状態はここに置く。**
   * 定義側に持たせると、2 つのセッションを同時に動かしたときに混ざる。
   * `session.reset()` で捨てられる
   */
  readonly memory: Map<string, number>;
  markSolved(): void;
  readonly solved: boolean;
}

export interface PuzzleDefinition {
  id: string;
  /** 人が読む説明。UI には出さない（ヒントは hints.ts が別に持つ） */
  summary: string;
  /**
   * このプロファイルで原理的に解けるか。CI が 4 世代すべてで評価する。
   * 副作用を持たせないこと（評価順に依存すると検証の意味が無くなる）
   */
  solvableIn(profile: GenerationProfile): boolean;
  update(ctx: PuzzleContext): void;
}

// --- パズル作者向けのヘルパ（世界の触り方をここに集約する） ---

export function bodyOf(ctx: PuzzleContext, id: string): StaticBodyData | undefined {
  const entity = ctx.entities.get(id);
  return entity === undefined ? undefined : ctx.world.get(entity, StaticBody);
}

/** ギミックの実体化・非実体化。見えないものに当たり判定を残さない */
export function setSolid(ctx: PuzzleContext, id: string, solid: boolean): void {
  const body = bodyOf(ctx, id);
  if (body) body.solid = solid;
}

export function boxOf(ctx: PuzzleContext, id: string): AABB | null {
  const body = bodyOf(ctx, id);
  return body ? aabbFromCenter(body.position, body.halfExtents) : null;
}

/** 現在の投影モード。2D では重なり判定が Z を見ない（§5.5） */
export function projectionOf(ctx: PuzzleContext): ProjectionMode {
  return ctx.profile.video.projection;
}

/**
 * プレイヤーがその要素に触れているか。
 * **判定は必ず `projection.overlaps` を通る**ので、2D では Z が無視される（§5.6）。
 */
export function playerTouches(ctx: PuzzleContext, id: string, margin = 0): boolean {
  const target = boxOf(ctx, id);
  if (!target) return false;
  const half = ctx.player.halfExtents;
  const body = aabbFromCenter(ctx.player.position, [half[0] + margin, half[1] + margin, half[2] + margin]);
  return overlaps(body, target, projectionOf(ctx));
}

/**
 * 要素を動かす（S-1 の公転、F-2 の標の揺れ）。
 *
 * **動きは必ず `tickIndex` から決定的に出すこと。** 実時間や乱数の状態から出すと、
 * リプレイが再現しなくなる（不変条件 I4）。
 */
export function moveTo(ctx: PuzzleContext, id: string, position: Vec3): void {
  const body = bodyOf(ctx, id);
  if (!body) return;
  body.position[0] = position[0];
  body.position[1] = position[1];
  body.position[2] = position[2];
}

/**
 * 「消えているスプライトは当たり判定も消える」は**廃止した**（T2 の決定 2）。
 *
 * 実機では表示が消えても存在は残るため、この差分は遊ぶ側の直感と噛み合わなかった
 *（ギミックレビュー F-2）。唯一の利用者だった F-2 が使うのをやめたので、
 * 判定用のヘルパごと削除してある。走査線制限は**描画にだけ**効く。
 * 経緯は `Docs/PHASE2_GIMMICK_PLAN.md` §6 の決定 2。
 */
