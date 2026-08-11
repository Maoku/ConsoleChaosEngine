/**
 * 当たり判定の可視化（T1-29）。
 *
 * **このテストが守るのは「赤の意味」。**
 * 赤（hidden）は「実体があるのに、その場所に絵が一切出ていない」だけを指す。
 * 見た目を別のモデルに預けている板（紫）や、すり抜けるトリガ（青）が
 * 赤に混ざると、試遊の報告で本物の「見えない床」を拾えなくなる。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession, type Session } from '@/gameplay/session';
import { createScene, type Scene } from '@/gameplay/scene';
import { parseLevel } from '@/level/loader';
import { createRawInput } from '@/input/mapper';
import { unsealShaderCompilation } from '@/render/gl/index';
import { PROFILES, type GenerationId } from '@/generation/profiles';
import {
  collectColliderBoxes,
  createColliderView,
  nearbyHidden,
  touchingBoxes,
  type ColliderBox,
} from '@/debug/collider_view';
import { colliderReportLines } from '@/debug/collider_hud';
import { createFakeGL } from './fake_gl';

const area1 = parseLevel(JSON.parse(readFileSync('public/assets/levels/area1.json', 'utf8')), 'area1.json');

function run(generation: GenerationId): { session: Session; scene: Scene; boxes: ColliderBox[] } {
  const session = createSession({ level: area1, generation });
  const scene = createScene(session);
  const neutral = createRawInput();
  // 出発地点は少し宙に浮いているので、着地するまで回す（接触の一覧を見るため）
  for (let i = 0; i < 16; i++) {
    session.tick(neutral);
    scene.update(1 / 60);
  }
  return { session, scene, boxes: collectColliderBoxes(session, scene.frame) };
}

function kindOf(boxes: readonly ColliderBox[], id: string): string | undefined {
  return boxes.find((box) => box.id === id)?.kind;
}

describe('当たり判定の分類', () => {
  it('レベルのすべての当たり判定とプレイヤーが 1 つずつ並ぶ', () => {
    const { boxes } = run('PS1');
    const collidable = area1.entities.filter((entity) => entity.collider).length;
    expect(boxes).toHaveLength(collidable + 1);
    expect(kindOf(boxes, 'player')).toBe('player');
  });

  it('床は緑（実体があり、絵も出ている）', () => {
    expect(kindOf(run('PS1').boxes, 'start_floor_a')).toBe('solid');
  });

  it('見た目を殻のモデルに預けている板は紫（赤にしない）', () => {
    const { boxes } = run('PS1');
    for (const id of ['p1_2_wall_top', 'p1_2_wall_right', 'p1_2_wall_front']) {
      expect(kindOf(boxes, id), id).toBe('proxy');
    }
    // 継ぎ目は第3世代でだけ通れる（P1-2）。通れる間は青、塞がっている世代では紫
    expect(kindOf(boxes, 'p1_2_seam')).toBe('passable');
    expect(kindOf(run('PS2').boxes, 'p1_2_seam')).toBe('proxy');
  });

  it('area1 には「見えない実体」が 1 つも無い（T2-04 で透明な塊を削除した）', () => {
    // 改訂前は P2-1 の塊が、透明なまま 3 × 4 × 4m の壁として立っていた
    //（ギミックレビュー P2-1）。同じものが戻ってきたらここで止める
    for (const generation of ['FC', 'SFC', 'PS1', 'PS2'] as const) {
      const hidden = run(generation).boxes.filter((box) => box.kind === 'hidden');
      expect(hidden.map((box) => box.id), generation).toEqual([]);
    }
  });

  it('実体を持たないギミックは、絵が出ていなくても青（すり抜けるので理不尽ではない）', () => {
    // S-1 の足場は加算合成を持たない世代で「見えず・乗れず」になる
    expect(kindOf(run('FC').boxes, 's1_platform')).toBe('passable');
    expect(kindOf(run('PS1').boxes, 's1_platform')).toBe('solid');
  });
});

describe('報告用の読み上げ', () => {
  it('乗っている床と、近くの見えない実体を文字にする', () => {
    const { session, boxes } = run('PS1');
    expect(touchingBoxes(session, boxes).map((box) => box.id)).toContain('start_floor_a');

    const lines = colliderReportLines(session, boxes);
    expect(lines[2]).toContain('CH 3');
    expect(lines[3]).toContain('start_floor_a(実体)');
    // 出発地点からは塊が遠いので、近くの一覧には出ない
    expect(lines[4]).toContain('なし');
  });

  it('見えない実体のそばへ行くと、id と距離が出る', () => {
    // area1 には現在この状態のものが無いので、分類だけを直接与えて確かめる
    const { session, scene } = run('PS1');
    const boxes: ColliderBox[] = [
      ...collectColliderBoxes(session, scene.frame),
      { id: 'ghost_wall', kind: 'hidden', center: [...session.player.position], half: [1, 1, 1] },
      { id: 'far_ghost', kind: 'hidden', center: [999, 0, 0], half: [1, 1, 1] },
    ];
    const hidden = nearbyHidden(session, boxes);
    expect(hidden.map(([id]) => id)).toEqual(['ghost_wall']);
    expect(hidden[0]?.[1]).toBeLessThan(5);
  });
});

describe('線の描画', () => {
  it('箱 1 つにつき 1 回、線分として描く', () => {
    unsealShaderCompilation();
    const fake = createFakeGL();
    const view = createColliderView(fake.ctx);
    const { scene, boxes } = run('PS1');
    const before = fake.callsOf('drawElements').length;
    view.draw(PROFILES['PS1'].video, scene.frame, boxes);
    const draws = fake.callsOf('drawElements').slice(before);
    expect(draws).toHaveLength(boxes.length);
    expect(draws[0]?.args[0]).toBe(fake.ctx.gl.LINES);
    view.dispose();
  });
});
