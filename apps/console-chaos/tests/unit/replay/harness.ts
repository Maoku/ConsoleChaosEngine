/**
 * リプレイテストの実行台（IMPLEMENTATION_PLAN §7.2）。
 *
 * シミュレーションが決定的である（不変条件 I4）ことを使い、
 * **入力列 + 期待される最終状態**で回帰を検出する。描画しないので CI で高速に回る。
 *
 * 進行順序そのものは `gameplay/session.ts`（ゲーム本体の組み立て）が持っており、
 * ここにあるのは「入力列を流し込み、結果を読む」だけ。
 * **画面で動いているものとリプレイが同じ組み立てを通る**ことが、この形の目的。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { GenerationId } from '@/generation/profiles';
import { createRawInput, type RawInput } from '@/input/mapper';
import { createSession } from '@/gameplay/session';
import type { Vec3 } from '@/gameplay/projection';
import { parseLevel } from '@/level/loader';
import { PIXELS_PER_WORLD_UNIT, type LevelFile } from '@/level/schema';
import { applyScanlineLimit, type SpriteDrawItem } from '@/render/sprite_limit';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface ReplaySegment {
  /** このセグメントを何ティック続けるか */
  ticks: number;
  /**
   * 左右と奥行き（-1..1、奥が負）。**画面に対する向き**で、ワールドの軸ではない。
   * 背後視点の世代（第4世代）では 90° 回った基底になる（T2-08）。省略時は静止
   */
  move?: [number, number];
  jump?: boolean;
  action?: boolean;
  /** このセグメントの先頭で押す世代切替 */
  switchTo?: GenerationId;
}

export interface ReplayRecord {
  level: string;
  puzzle: string;
  /** 出発位置。パズルの区画へ直接置く（レベル全体の踏破は T1-15 の担当） */
  spawn: [number, number, number];
  generation: GenerationId;
  /**
   * 乱数の種（T2 の決定 3）。正解ルートが試行ごとに変わる部屋（F-2 / P2-1）は、
   * これが無いと記録を再生できない。省略時はセッションの既定値
   */
  seed?: number;
  inputs: ReplaySegment[];
  expect: {
    solved: boolean;
    /** 通し走行用。最後に解けているべきパズルの集合 */
    solvedAll?: string[];
    /** 解けたティック（solved が真のとき）。決定性の回帰検出に使う */
    solvedAtTick?: number;
    /** 最終位置の許容誤差付き確認（省略可） */
    position?: [number, number, number];
    tolerance?: number;
  };
}

export function loadLevelFile(id: string): LevelFile {
  const path = join(ROOT, 'public/assets/levels', `${id}.json`);
  return parseLevel(JSON.parse(readFileSync(path, 'utf8')), `${id}.json`);
}

export interface ReplayResult {
  solved: boolean;
  /** 実行後に解けていたパズル（id 昇順） */
  solvedAll: string[];
  solvedAtTick: number | null;
  ticks: number;
  position: Vec3;
  velocity: Vec3;
  generation: GenerationId;
  checkpoint: {
    active: Vec3;
    reached: string[];
    phase: string;
    respawnCount: number;
  };
  seed: number;
}

/**
 * 走査線制限のための画面 Y（実寸 1 ワールド単位 = 32 画素、プレイヤーを中央に置く窓）。
 * 本来は描画側が持つ計算なので、ヘッドレスではここが肩代わりする。
 */
function screenYOf(worldY: number, playerY: number, internalHeight: number): number {
  const halfView = internalHeight / (2 * PIXELS_PER_WORLD_UNIT);
  return (playerY + halfView - worldY) * PIXELS_PER_WORLD_UNIT;
}

/** 1 本のリプレイを再生する。同じ入力からは必ず同じ結果になる（不変条件 I4） */
export function runReplay(record: ReplayRecord): ReplayResult {
  const session = createSession({
    level: loadLevelFile(record.level),
    generation: record.generation,
    spawn: [...record.spawn] as Vec3,
    ...(record.seed === undefined ? {} : { seed: record.seed }),
  });

  const raw: RawInput = createRawInput();
  let solvedAtTick: number | null = null;

  for (const segment of record.inputs) {
    for (let i = 0; i < segment.ticks; i++) {
      raw.move[0] = segment.move?.[0] ?? 0;
      raw.move[1] = segment.move?.[1] ?? 0;
      raw.jump = segment.jump ?? false;
      raw.action = segment.action ?? false;
      // 切替はセグメントの先頭の 1 ティックだけ押す（押しっぱなしにしない）
      raw.switchTo = i === 0 ? (segment.switchTo ?? null) : null;

      session.tick(raw);

      if (solvedAtTick === null && session.solved.has(record.puzzle)) {
        solvedAtTick = session.tickIndex - 1;
      }

      // 段階 9：走査線制限を評価し、結果を次ティックへ書き戻す
      const profile = session.profile;
      const sprites: SpriteDrawItem[] = session.sprites.map(({ entity, body }) => ({
        entity,
        y: screenYOf(body.position[1] + body.halfExtents[1], session.player.position[1], profile.video.internalHeight),
        height: body.halfExtents[1] * 2 * PIXELS_PER_WORLD_UNIT,
      }));
      session.commitCulled(
        applyScanlineLimit(sprites, profile.video.spritesPerScanline, profile.video.internalHeight).culled,
      );
    }
  }

  return {
    solved: session.solved.has(record.puzzle),
    solvedAll: [...session.solved].sort(),
    solvedAtTick,
    ticks: session.tickIndex,
    position: [...session.player.position] as Vec3,
    velocity: [...session.player.velocity] as Vec3,
    generation: session.switcher.generation,
    checkpoint: {
      active: [...session.checkpoints.active] as Vec3,
      reached: [...session.checkpoints.reached],
      phase: session.checkpoints.phase,
      respawnCount: session.checkpoints.respawnCount,
    },
    seed: record.seed ?? 0x436861,
  };
}

export function loadReplay(name: string): ReplayRecord {
  const path = join(dirname(fileURLToPath(import.meta.url)), `${name}.replay.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as ReplayRecord;
}
