/**
 * プレイヤースプライトのゴールデン（T2-09 で第1世代、T2-11 で第2世代）。
 *
 * `PlayerSpriteProfile` はアトラスの**中身の並びと寸法**を直に指す。
 * ここが実物とずれると、待機で歩行のコマが出る・足が床にめり込む・歩くと横へ滑る、
 * といった「動かして初めて分かる」壊れ方をする。絵そのものを検査して機械的に止める。
 *
 * アトラスは `tools/make-hero-sprite.ts` の出力（`npm run make:hero-sprite`）で、
 * 素材は `Docs/hero-gen-N-animations/`。素材を差し替えたら作り直してからここを通す。
 *
 * **検査は世代を数えず、絵で描く世代すべてに同じものを掛ける。**
 * 世代を増やしたら `PROFILES` に足すだけでここも回る。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, type RgbaImage } from '@console-chaos/asset-pipeline';
import { spriteCellCount } from '@/render/sprite_sheet';
import { CONSOLE_CHAOS_GENERATION_THEMES, type PlayerClip, type PlayerSpriteProfile } from '@/config/generation';
import { GENERATION_IDS } from '../generations';
import { PIXELS_PER_WORLD_UNIT } from '@/level/schema';

const SPRITE_DIR = 'public/assets/sprites';

/** 当たり判定の身長（`PlayerBody.halfExtents[1]` の 2 倍） */
const COLLIDER_HEIGHT = 1.6;

/**
 * 立ち姿の身長が当たり判定からどれだけ離れてよいか（メートル）。
 * 素材は世代ごとに別々に生成されており、体の大きさは完全には揃わない
 */
const HEIGHT_TOLERANCE = 0.1;

/** 地面に足が着いているクリップ。接地線の検査はこの 2 つに掛ける */
const GROUNDED: PlayerClip[] = ['idle', 'walk'];

/** 絵で描く世代（第1・第2世代）。ここが空になったらテストごと落とす */
const SPRITE_GENERATIONS = GENERATION_IDS.flatMap((id) => {
  const player = CONSOLE_CHAOS_GENERATION_THEMES[id].player;
  return player.kind === 'sprite' ? [{ id, sprite: player as PlayerSpriteProfile }] : [];
});

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

describe('プレイヤースプライト', () => {
  it('絵で描く世代が存在する（検査が素通りしていないこと）', () => {
    expect(SPRITE_GENERATIONS.map((entry) => entry.id)).toEqual(['FC', 'SFC']);
  });
});

describe.each(SPRITE_GENERATIONS)('$id のプレイヤースプライト', ({ sprite }) => {
  const atlas: RgbaImage = decodePng(readFileSync(join(SPRITE_DIR, sprite.file)));

  /** セルの中の不透明部分の外接矩形（セルの左上を原点とする） */
  function boundsOf(cell: number): Bounds | null {
    const originX = (cell % sprite.columns) * sprite.cell;
    const originY = Math.floor(cell / sprite.columns) * sprite.cell;
    const box: Bounds = { minX: sprite.cell, minY: sprite.cell, maxX: -1, maxY: -1 };
    for (let y = 0; y < sprite.cell; y++) {
      for (let x = 0; x < sprite.cell; x++) {
        if (atlas.data[((originY + y) * atlas.width + originX + x) * 4 + 3]! === 0) continue;
        if (x < box.minX) box.minX = x;
        if (x > box.maxX) box.maxX = x;
        if (y < box.minY) box.minY = y;
        if (y > box.maxY) box.maxY = y;
      }
    }
    return box.maxX < 0 ? null : box;
  }

  /** クリップが使うセル番号 */
  function cellsOf(clip: PlayerClip): number[] {
    const ref = sprite.clips[clip];
    return Array.from({ length: ref.frames }, (_, i) => ref.first + i);
  }

  it('アトラスの実体があり、寸法がプロファイルの宣言と一致する', () => {
    expect(existsSync(join(SPRITE_DIR, sprite.file)), `${sprite.file} が無い`).toBe(true);
    expect(atlas.width).toBe(sprite.columns * sprite.cell);
    expect(atlas.height).toBe(sprite.rows * sprite.cell);
    // asset-rules.md §7 の上限
    expect(atlas.width).toBeLessThanOrEqual(256);
    expect(atlas.height).toBeLessThanOrEqual(256);
  });

  it('セル 1 つが画素等倍で表示される大きさになっている', () => {
    // 64px / 32 = 2m。ここがずれると絵が拡大縮小され、画素の粗さが揃わなくなる
    expect(sprite.worldSize).toBeCloseTo(sprite.cell / PIXELS_PER_WORLD_UNIT, 12);
  });

  it('アルファは 0 か 255 しかない（半透明合成に頼らず抜きで形を出す）', () => {
    const values = new Set<number>();
    for (let i = 3; i < atlas.data.length; i += 4) values.add(atlas.data[i]!);
    expect([...values].sort((a, b) => a - b)).toEqual([0, 255]);
  });

  it('どのクリップのコマにも絵があり、アトラスの中に収まる', () => {
    for (const clip of Object.keys(sprite.clips) as PlayerClip[]) {
      for (const cell of cellsOf(clip)) {
        expect(cell, `${clip} のセル ${cell}`).toBeLessThan(spriteCellCount(sprite));
        expect(boundsOf(cell), `${clip} のセル ${cell} が空`).not.toBeNull();
      }
    }
  });

  it('絵が隣のセルへはみ出していない（左右と上端に余白がある）', () => {
    for (let cell = 0; cell < spriteCellCount(sprite); cell++) {
      const box = boundsOf(cell)!;
      expect(box.minX, `セル ${cell} の左端`).toBeGreaterThan(0);
      expect(box.maxX, `セル ${cell} の右端`).toBeLessThan(sprite.cell - 1);
      expect(box.minY, `セル ${cell} の上端`).toBeGreaterThan(0);
    }
  });

  it('セルの下端が接地線になっている（足が床から浮かない・めり込まない）', () => {
    for (const clip of Object.keys(sprite.clips) as PlayerClip[]) {
      const deepest = Math.max(...cellsOf(clip).map((cell) => boundsOf(cell)!.maxY));
      expect(deepest, `${clip} のいちばん深い足`).toBe(sprite.cell - 1);
    }
  });

  it('立ち姿の身長が当たり判定（1.6m）とほぼ一致する', () => {
    for (const cell of cellsOf('idle')) {
      const box = boundsOf(cell)!;
      const meters = ((box.maxY - box.minY + 1) / sprite.cell) * sprite.worldSize;
      expect(Math.abs(meters - COLLIDER_HEIGHT), `セル ${cell} の身長 ${meters}m`).toBeLessThan(HEIGHT_TOLERANCE);
    }
  });

  it('歩きのコマは横位置が揃っている（歩くと左右へ滑る、が起きない）', () => {
    // 素材のままだと 6 コマで 70px 以上（＝縮小後 18px 以上）流れる。
    // `make-hero-sprite.ts` が付け直した結果をここで固定する
    const center = (sprite.cell - 1) / 2;
    for (const cell of cellsOf('walk')) {
      const box = boundsOf(cell)!;
      expect(Math.abs((box.minX + box.maxX) / 2 - center), `セル ${cell}`).toBeLessThanOrEqual(1);
    }
  });

  it('待機は歩きともジャンプとも別のコマを指す', () => {
    // 素材に待機のクリップは無く、「手を前に出す」の 1 コマ目を借りている。
    // ここが歩きのコマへずれると、立ち止まっているのに脚が開いた絵が出る。
    // 「立ち姿であること」自体は上の身長の検査（当たり判定と ±0.1m）が見る
    expect(cellsOf('walk')).not.toContain(sprite.clips.idle.first);
    expect(cellsOf('jump')).not.toContain(sprite.clips.idle.first);
  });

  it('接地するクリップは、地面に足が着く高さで描かれている', () => {
    // 待機と歩きは足元が接地線の近くに来る（浮いたまま歩かない）
    for (const clip of GROUNDED) {
      for (const cell of cellsOf(clip)) {
        expect(boundsOf(cell)!.maxY, `${clip} のセル ${cell}`).toBeGreaterThanOrEqual(sprite.cell - 3);
      }
    }
  });
});
