/**
 * 世界 → 描画コマンドの組み立て（T1-24 / T1-25）。
 *
 * **「何が消えるか」はこのテストが正本。**
 * 計画 §3-4 の「消える で表現しない」を機械的に守る。消えてよいのは 3 つだけで、
 * それ以外は見え方の変化で表す。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Session } from '@/gameplay/session';
import { buildDrawables, createScene, interiorSectorIds } from '@/gameplay/scene';
import { parseLevel } from '@/level/loader';
import { materialFor } from '@/render/material';
import { createRawInput } from '@/input/mapper';
import { GENERATION_IDS, PROFILES, type GenerationId } from '@/generation/profiles';
import { createTestSession, tickSession } from './session-testkit';

const area1 = parseLevel(JSON.parse(readFileSync('public/assets/levels/area1.json', 'utf8')), 'area1.json');

/** 世代を確定させ、数ティック回してから可視の表を返す */
function visibilityIn(generation: GenerationId): Map<string, boolean> {
  const session: Session = createTestSession({ level: area1, generation });
  const scene = createScene(session);
  const neutral = createRawInput();
  for (let i = 0; i < 4; i++) {
    tickSession(session, neutral);
    scene.update(1 / 60);
  }
  const table = new Map<string, boolean>();
  scene.frame.drawables.forEach((drawable, index) => {
    table.set(drawable.key, scene.frame.visible[index] === 1);
  });
  return table;
}

describe('描画コマンドの組み立て', () => {
  it('レベルのすべての要素が描画対象になる（SG-05 で装飾へ広げた）', () => {
    const drawables = buildDrawables(area1);
    // 当たり判定だけを持つ要素（殻の板）は描画に積まれない
    const collisionOnly = area1.entities.filter((e) => materialFor(e.type, e.id).collisionOnly).length;
    expect(drawables).toHaveLength(area1.entities.length - collisionOnly);
    expect(collisionOnly).toBe(8);
    expect(drawables.every((drawable) => drawable.material !== undefined)).toBe(true);
  });

  it('装飾は当たり判定の代わりに transform.scale を大きさに使う（SG-05）', () => {
    // `LevelEntity.collider` は元から任意で、`LevelTransform.scale` も既にある。
    // **スキーマの変更は 0 行**で装飾が置ける、というのが判断 E の要点
    for (const entity of area1.entities) {
      if (entity.collider) continue;
      const drawable = buildDrawables(area1).find((d) => d.key === entity.id)!;
      expect(drawable.halfExtents, entity.id).toEqual(entity.transform.scale ?? [1, 1, 1]);
      expect(drawable.position, entity.id).toEqual(entity.transform.position);
    }
  });

  it('影を落とす要素には、落ちる先の床の高さが入る', () => {
    const pillar = buildDrawables(area1).find((drawable) => drawable.key === 'p2_1_pillar_a');
    expect(pillar?.material.castShadow).toBe(true);
    // p2_1_entry は中心 -4.25 / 半径 0.25 なので天面は -4
    expect(pillar?.groundY).toBeCloseTo(-4, 6);
  });
});

describe('装飾（SG-05、上位計画 §3 の決定 2）', () => {
  it('装飾は物理に現れない（session.bodies() に居ない）', () => {
    // **これが装飾の定義そのもの。** 物理に居ない＝投影にもパズルにも現れないので、
    // `requiredGenerations` と `solvableIn` は機械的に変わりようがない
    const session = createTestSession({ level: area1, generation: 'PS2' });
    const bodies = session.bodies();
    for (const entity of area1.entities) {
      expect(bodies.has(entity.id), entity.id).toBe(entity.collider !== undefined);
      expect(materialFor(entity.type, entity.id).decoration, entity.id).toBe(entity.collider === undefined);
    }
  });

  it('装飾はレベルが置いた場所に、どの世代でも見えたまま出る', () => {
    const decor = area1.entities.filter((entity) => entity.collider === undefined);
    for (const generation of GENERATION_IDS) {
      const session = createTestSession({ level: area1, generation });
      const scene = createScene(session);
      const neutral = createRawInput();
      tickSession(session, neutral);
      scene.update(1 / 60);
      for (const entity of decor) {
        const index = scene.frame.drawables.findIndex((d) => d.key === entity.id);
        expect(scene.frame.visible[index], `${generation} / ${entity.id}`).toBe(1);
        expect([...scene.frame.positions.slice(index * 3, index * 3 + 3)], entity.id).toEqual(
          entity.transform.position,
        );
      }
    }
  });
});

describe('消えるものは 3 つだけ（計画 §3-4）', () => {
  it('S-1 の足場は加算合成を持たない世代でだけ描かれない', () => {
    expect(visibilityIn('FC').get('s1_platform')).toBe(false);
    for (const generation of ['SFC', 'PS1', 'PS2'] as const) {
      expect(visibilityIn(generation).get('s1_platform'), generation).toBe(true);
    }
  });

  it('F-1 は「撚られた 1 本」と「別々の 2 本」が排他で現れる', () => {
    const fc = visibilityIn('FC');
    expect(fc.get('f1_braid')).toBe(true);
    expect(fc.get('f1_vine_a')).toBe(false);
    const ps1 = visibilityIn('PS1');
    expect(ps1.get('f1_braid')).toBe(false);
    expect(ps1.get('f1_vine_a')).toBe(true);
    expect(ps1.get('f1_vine_b')).toBe(true);
  });

  it('P1-2 の殻はどの世代でも消えない（改訂前は第3世代で消滅していた）', () => {
    for (const generation of ['FC', 'SFC', 'PS1', 'PS2'] as const) {
      expect(visibilityIn(generation).get('p1_2_shell'), generation).toBe(true);
    }
  });

  it('壁・床・台座・刻印はどの世代でも消えない', () => {
    for (const generation of ['FC', 'SFC', 'PS1', 'PS2'] as const) {
      const table = visibilityIn(generation);
      for (const id of ['p1_1_wall', 'p1_1_floor', 'f1_pedestal', 'p2_1_mark', 'p1_2_core', 'p2_1_pillar_a']) {
        expect(table.get(id), `${id} / ${generation}`).toBe(true);
      }
    }
  });
});

describe('カメラの構図（T2-08）', () => {
  /** 数ティック回した後の session / scene を返す。move は毎ティック同じ入力を与える */
  function run(generation: GenerationId, ticks = 8, move: [number, number] = [0, 0]) {
    const session: Session = createTestSession({ level: area1, generation });
    const scene = createScene(session);
    const input = { ...createRawInput(), move: [...move] as [number, number] };
    for (let i = 0; i < ticks; i++) {
      tickSession(session, input);
      scene.update(1 / 60);
    }
    return { session, camera: scene.frame.camera, scene, input };
  }

  it('第1〜第3世代はプレイヤーの真横（手前）に立つ', () => {
    for (const generation of ['FC', 'SFC', 'PS1'] as const) {
      const { session, camera } = run(generation);
      const player = session.player.position;
      expect(camera.position[0], generation).toBeCloseTo(player[0]!, 6);
      // 手前（+Z）に引き、視線は奥（-Z）へ向く
      expect(camera.position[2]!, generation).toBeGreaterThan(player[2]!);
      expect(camera.target[2]!, generation).toBeLessThanOrEqual(player[2]!);
    }
  });

  it('第3世代のカメラはプロファイルどおりの距離と高さに立つ（BR-04）', () => {
    const { session, camera } = run('PS1');
    const player = session.player.position;
    const lens = PROFILES.PS1.camera;
    // 画角は 55° 固定なので、大きさは距離だけで決まる。T2-08 の 4.5 から 1.5 倍寄せた
    expect(camera.position[2]! - player[2]!).toBeCloseTo(lens.distance, 6);
    expect(camera.position[1]! - player[1]!).toBeCloseTo(lens.height, 6);
    expect(lens.distance).toBeCloseTo(4.5 / 1.5, 6);
  });

  it('第4世代はプレイヤーの背後に立ち、進行方向の先を見る', () => {
    const { session, camera } = run('PS2');
    const player = session.player.position;
    expect(session.playerState.facing).toBe(1);
    // 背中側（-X）に引いて、注視点はプレイヤーより先（+X）
    expect(camera.position[0]!).toBeLessThan(player[0]! - 3);
    expect(camera.target[0]!).toBeGreaterThan(player[0]! + 4);
    // 進行方向の軸に乗るので、Z のずれは残らない
    expect(camera.position[2]!).toBeCloseTo(player[2]!, 6);
    expect(camera.target[2]!).toBeCloseTo(player[2]!, 6);
  });

  it('第4世代のカメラは向きが反転しても回らない（移動がカメラ相対だから）', () => {
    // 手前（カメラ側）へ倒し続けると向きは反転するが、カメラは通路の奥を向いたまま。
    // ここが回ると「後ろへ倒す → 前後が入れ替わる」の帰還路ができて振動する
    const { session, camera } = run('PS2', 40, [0, 1]);
    expect(session.playerState.facing).toBe(-1);
    expect(camera.position[0]!).toBeLessThan(session.player.position[0]!);
    expect(camera.target[0]!).toBeGreaterThan(session.player.position[0]!);
  });

  it('第4世代は奥へ倒すと画面の奥（+X）へ進む', () => {
    const { session } = run('PS2', 30, [0, -1]);
    // 出発は x=1。奥へ倒し続けた結果、通路の奥へ進んでいる
    expect(session.player.position[0]!).toBeGreaterThan(2);
    expect(Math.abs(session.player.position[2]!)).toBeLessThan(1e-6);
  });

  it('外部アセットの正面（+Z）は半回転で吸収する（T2-08）', () => {
    // 右を向いているとき、-Z 正面のモデルは -90°、+Z 正面のモデルはその半回転ぶん先
    const lowPoly = run('SFC').scene.frame.player.yaw;
    const external = run('PS1').scene.frame.player.yaw;
    expect(lowPoly).toBeCloseTo(-Math.PI / 2, 6);
    expect(external).toBeCloseTo(Math.PI / 2, 6);
  });

  it('絵で描く世代へは左右の向きがそのまま渡る（T2-09）', () => {
    // スプライトは回らず左右反転で向きを出すので、回転角ではなく facing を読む
    expect(run('FC', 20, [1, 0]).scene.frame.player.facing).toBe(1);
    expect(run('FC', 20, [-1, 0]).scene.frame.player.facing).toBe(-1);
  });

  it('2D 世代のカメラは正射影で、プレイヤーと同じ高さから見る', () => {
    for (const generation of ['FC', 'SFC'] as const) {
      const { session, camera } = run(generation);
      expect(camera.projection, generation).toBe('ortho');
      expect(camera.position[1], generation).toBeCloseTo(session.player.position[1]!, 6);
    }
  });
});

describe('材質の割り当て', () => {
  it('半透明で描くのは S-1 の足場だけ', () => {
    const translucent = buildDrawables(area1)
      .filter((drawable) => drawable.material.translucent)
      .map((drawable) => drawable.key)
      .sort();
    expect(translucent).toEqual(['s1_platform']);
  });

  it('暗室の材質だけが環境光をほぼ持たない（松明の光しか届かない）', () => {
    const dark = buildDrawables(area1)
      .filter((drawable) => drawable.material.ambient < 0.1)
      .map((drawable) => drawable.key);
    // P2-1 の部屋（渡り廊下・柱・刻印）だけ
    expect(dark.every((key) => key.startsWith('p2_1_'))).toBe(true);
    expect(dark.length).toBeGreaterThan(0);
  });

  it('影を落とすのは暗室の柱だけ', () => {
    const casters = buildDrawables(area1)
      .filter((drawable) => drawable.material.castShadow)
      .map((drawable) => drawable.key);
    expect(casters).toEqual(['p2_1_pillar_a', 'p2_1_pillar_b', 'p2_1_pillar_c']);
  });

  it('三角形ソートを掛けるのは殻だけ（予算を守るため対象を絞る）', () => {
    const sorted = buildDrawables(area1)
      .filter((drawable) => drawable.material.polygonSort)
      .map((drawable) => drawable.key);
    expect(sorted).toEqual(['p1_2_shell']);
  });

  it('未知の種別は既定の材質へ落ちる（レベル側の書き間違いを黙って通さない）', () => {
    expect(materialFor('__unknown__').role).toBe('background');
  });
});

describe('空の見えない部屋（BR-03）', () => {
  /** 指定の位置から始めて、指定の秒数ぶん回した後の背景の明るさ */
  function brightnessAt(generation: GenerationId, spawn: [number, number, number], seconds: number): number {
    const session: Session = createTestSession({ level: area1, generation, spawn });
    const scene = createScene(session);
    const neutral = createRawInput();
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      tickSession(session, neutral);
      scene.update(1 / 60);
    }
    return scene.frame.backdrop.brightness;
  }

  it('`dark()` の材質は必ず interior を持つ（暗室の宣言が 2 か所に割れない）', () => {
    const dark = buildDrawables(area1).filter((drawable) => drawable.material.ambient < 0.1);
    expect(dark.length).toBeGreaterThan(0);
    for (const drawable of dark) {
      expect(drawable.material.interior, drawable.key).toBe(true);
    }
    // 逆も要る。interior を持つのは暗い材質だけ
    for (const drawable of buildDrawables(area1)) {
      if (drawable.material.interior) expect(drawable.material.ambient, drawable.key).toBeLessThan(0.1);
    }
  });

  it('暗室のセクタは P2-1 の部屋だけ', () => {
    expect([...interiorSectorIds(area1)]).toEqual(['p2_1']);
  });

  it('暗室にいる間は背景の明るさが 0 へ向かう（黒い床がシルエットにならない）', () => {
    // 渡り廊下の上（p2_1 の部屋の中ほど）。どの世代でも同じ場所なら同じ暗さになる
    for (const id of GENERATION_IDS) {
      expect(brightnessAt(id, [103, -3.5, 0], 0.5), id).toBe(0);
    }
  });

  it('明るい部屋では 1 のまま（暗室以外の見えは変わらない）', () => {
    for (const id of GENERATION_IDS) {
      expect(brightnessAt(id, [1, 1, 0], 0.5), id).toBe(1);
    }
  });

  it('出入りは一瞬ではなく補間される（切り替わりが目に痛くない）', () => {
    // 0.25 秒で切り替わるので、1/60 秒後はまだ途中
    const partial = brightnessAt('PS2', [103, -3.5, 0], 1 / 60);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
  });
});
