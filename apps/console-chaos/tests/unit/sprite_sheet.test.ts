/**
 * スプライトシートの読み方（T2-09）。
 *
 * コマ送りは「見れば分かる」たぐいの壊れ方をしない。歩きが 1 コマだけ飛ぶ、
 * 滞空の長いジャンプで踏み切りの絵に戻る、といったずれは目視では拾えないので、
 * 時刻 → セル番号の対応をここで固定する。
 */
import { describe, it, expect } from 'vitest';
import { spriteCellCount, spriteCellOf, spriteUvRect } from '@/render/sprite_sheet';
import { CONSOLE_CHAOS_GENERATION_THEMES, type PlayerSpriteProfile } from '@/config/generation';

const sprite = CONSOLE_CHAOS_GENERATION_THEMES.FC.player as PlayerSpriteProfile;

describe('スプライトのコマ送り', () => {
  it('先頭のコマは 0 秒から始まる', () => {
    for (const clip of Object.values(sprite.clips)) {
      expect(spriteCellOf(clip, 0)).toBe(clip.first);
    }
  });

  it('歩きは 1 周したら先頭へ戻る', () => {
    const walk = sprite.clips.walk;
    const cycle = walk.frames * walk.frameSeconds;
    for (let i = 0; i < walk.frames; i++) {
      const at = (i + 0.5) * walk.frameSeconds;
      expect(spriteCellOf(walk, at), `${i} コマ目`).toBe(walk.first + i);
      // 1 周ぶん進めても同じコマ
      expect(spriteCellOf(walk, at + cycle)).toBe(walk.first + i);
    }
  });

  it('ジャンプは末尾のコマで止まる（滞空が長くても踏み切りへ戻らない）', () => {
    const jump = sprite.clips.jump;
    const last = jump.first + jump.frames - 1;
    expect(spriteCellOf(jump, jump.frames * jump.frameSeconds)).toBe(last);
    expect(spriteCellOf(jump, 60)).toBe(last);
  });

  it('待機は 1 コマしか無いので、いつ見ても同じ絵', () => {
    for (const seconds of [0, 0.5, 10]) {
      expect(spriteCellOf(sprite.clips.idle, seconds)).toBe(sprite.clips.idle.first);
    }
  });

  it('負の時刻でも先頭のコマに落ちる（クリップの切替直後を踏んでも壊れない）', () => {
    expect(spriteCellOf(sprite.clips.walk, -1)).toBe(sprite.clips.walk.first);
  });
});

describe('セル番号 → UV', () => {
  it('左上のセルが原点、右下のセルが端に届く', () => {
    expect(spriteUvRect(sprite, 0)).toEqual({ u0: 0, v0: 0, u1: 1 / 4, v1: 1 / 4 });
    const last = spriteUvRect(sprite, spriteCellCount(sprite) - 1);
    expect(last.u1).toBeCloseTo(1, 12);
    expect(last.v1).toBeCloseTo(1, 12);
  });

  it('セルは行優先で並ぶ（列数を跨いだら次の行）', () => {
    const wrapped = spriteUvRect(sprite, sprite.columns);
    expect(wrapped.u0).toBe(0);
    expect(wrapped.v0).toBeCloseTo(1 / sprite.rows, 12);
  });

  it('どのクリップもアトラスの中に収まる', () => {
    for (const [name, clip] of Object.entries(sprite.clips)) {
      expect(clip.first, name).toBeGreaterThanOrEqual(0);
      expect(clip.first + clip.frames, name).toBeLessThanOrEqual(spriteCellCount(sprite));
      expect(clip.frameSeconds, name).toBeGreaterThan(0);
    }
  });
});
