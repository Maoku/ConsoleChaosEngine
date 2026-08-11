import { describe, it, expect } from 'vitest';
import { allPuzzles, generationChecks, VERTICAL_SLICE_PUZZLES } from '@/gameplay/puzzles/registry';
import { F1_BRAID, F1_PEDESTAL, F1_VINE_A, F1_VINE_B, F1_BREAK_TICKS, f1ColorCrush } from '@/gameplay/puzzles/f1_color_crush';
import {
  F2_LAMP_IDS,
  F2_PEDESTAL,
  F2_SAFE_COUNT,
  F2_SWARM_COUNT,
  F2_SWARM_IDS,
  F2_TILE_COUNT,
  F2_TILE_IDS,
  f2FlickerGap,
  routeOf,
} from '@/gameplay/puzzles/f2_flicker_gap';
import {
  S1_ISLAND,
  S1_PEDESTAL,
  S1_PIVOT,
  S1_PLATFORM,
  S1_PERIOD_TICKS,
  planeAngleAt,
  s1AffinePlane,
} from '@/gameplay/puzzles/s1_affine_plane';
import { P1_1_SWITCH, p1BackSide } from '@/gameplay/puzzles/p1_1_backside';
import { P1_2_CORE, P1_2_SEAM, P1_2_SHELL, p1SortBreak } from '@/gameplay/puzzles/p1_2_sort_break';
import { P2_1_LANE_Z, P2_1_MARK, P2_1_SLAB_COUNT, P2_1_SLAB_IDS, causewayOf, p2Torch } from '@/gameplay/puzzles/p2_1_torch';
import type { PuzzleContext, PuzzleDefinition } from '@/gameplay/puzzles/types';
import { StaticBody } from '@/gameplay/physics';
import { PlayerBody, type PlayerBodyData } from '@/gameplay/player';
import { createWorld, type Entity } from '@/core/ecs/world';
import { GENERATION_IDS, PROFILES, type GenerationId } from '@/generation/profiles';
import type { Vec3 } from '@/gameplay/projection';

/** パズル 1 件分の試験台。要素は id で置き、プレイヤーを好きな位置へ動かせる */
function lab(ids: readonly string[]) {
  const world = createWorld();
  const entities = new Map<string, Entity>();
  for (const id of ids) {
    const entity = world.create();
    // 位置は重ならないよう id ごとにずらす。触れる判定はテスト側で位置を合わせる
    world.add(entity, StaticBody, {
      position: [100 + entities.size * 10, 0, 0] as Vec3,
      halfExtents: [0.5, 0.5, 0.5] as Vec3,
      solid: true,
    });
    entities.set(id, entity);
  }
  const playerEntity = world.create();
  const player: PlayerBodyData = world.add(playerEntity, PlayerBody);
  player.position = [-1000, 0, 0];

  let solved = false;
  let tickIndex = 0;
  let attemptSeed = 1;
  const memory = new Map<string, number>();

  const ctx: PuzzleContext = {
    world,
    profile: PROFILES.FC,
    entities,
    player,
    memory,
    get tickIndex() {
      return tickIndex;
    },
    get attemptSeed() {
      return attemptSeed;
    },
    markSolved: () => {
      solved = true;
    },
    get solved() {
      return solved;
    },
  };

  return {
    ctx,
    world,
    entities,
    player,
    memory,
    get solved() {
      return solved;
    },
    setAttempt(seed: number): void {
      attemptSeed = seed;
    },
    /** 指定の要素へプレイヤーを重ねる */
    moveTo(id: string): void {
      const body = world.get(entities.get(id)!, StaticBody)!;
      player.position = [...body.position] as Vec3;
    },
    positionOf(id: string): Vec3 {
      return [...world.get(entities.get(id)!, StaticBody)!.position] as Vec3;
    },
    place(id: string, position: Vec3, halfExtents?: Vec3): void {
      const body = world.get(entities.get(id)!, StaticBody)!;
      body.position = [...position] as Vec3;
      if (halfExtents) body.halfExtents = [...halfExtents] as Vec3;
    },
    solidOf(id: string): boolean {
      return world.get(entities.get(id)!, StaticBody)!.solid;
    },
    run(generation: GenerationId, definition: PuzzleDefinition, ticks = 1): void {
      ctx.profile = PROFILES[generation];
      for (let i = 0; i < ticks; i++) {
        definition.update(ctx);
        tickIndex++;
      }
    },
  };
}

/** 4 世代それぞれで solvableIn を評価する */
function solvableSet(definition: PuzzleDefinition): GenerationId[] {
  return GENERATION_IDS.filter((id) => definition.solvableIn(PROFILES[id]));
}

describe('gameplay/puzzles の登録（§7.3）', () => {
  it('★ の 6 件が登録されている', () => {
    expect(allPuzzles().map((p) => p.id)).toEqual(['F-1', 'F-2', 'S-1', 'P1-1', 'P1-2', 'P2-1']);
    expect(VERTICAL_SLICE_PUZZLES).toHaveLength(6);
  });

  it('CI 用の変換が 4 世代すべてを評価できる', () => {
    const checks = generationChecks();
    expect(checks).toHaveLength(6);
    for (const check of checks) {
      for (const id of GENERATION_IDS) expect(typeof check.solvableIn(id)).toBe('boolean');
    }
  });

  it('どのパズルも「どの世代でも解ける」ことはない（世代差がある）', () => {
    for (const definition of allPuzzles()) {
      const set = solvableSet(definition);
      expect(set.length).toBeGreaterThan(0);
      expect(set.length).toBeLessThan(GENERATION_IDS.length);
    }
  });

  it('solvableIn に副作用が無い（CI の評価順に依存しない）', () => {
    for (const definition of allPuzzles()) {
      const first = solvableSet(definition);
      const second = solvableSet(definition);
      expect(second).toEqual(first);
    }
  });
});

describe('F-1 ツタの橋（色が潰れる世代がいちばん楽）', () => {
  const ids = [F1_VINE_A, F1_VINE_B, F1_BRAID, F1_PEDESTAL];

  it('撚られるか、乗る糸を選べるかのどちらかで渡れる', () => {
    // 色が潰れる CH 1 と、奥行きで糸を選べる CH 3 / CH 4。CH 2 だけが渡れない
    expect(solvableSet(f1ColorCrush)).toEqual(['FC', 'PS1', 'PS2']);
  });

  it('潰れている間は撚られた 1 本だけが実体になる（2 本は消える）', () => {
    const scene = lab(ids);
    scene.run('FC', f1ColorCrush);
    expect(scene.solidOf(F1_BRAID)).toBe(true);
    expect(scene.solidOf(F1_VINE_A)).toBe(false);
    expect(scene.solidOf(F1_VINE_B)).toBe(false);

    scene.run('PS1', f1ColorCrush);
    expect(scene.solidOf(F1_BRAID)).toBe(false);
    expect(scene.solidOf(F1_VINE_A)).toBe(true);
  });

  it('黄緑に乗り続けると切れ、緑も一緒に垂れる', () => {
    const scene = lab(ids);
    scene.place(F1_VINE_B, [0, 0, 0], [4, 0.25, 0.25]);
    scene.place(F1_VINE_A, [0, 0, 1.5], [4, 0.25, 0.25]);
    // 黄緑の真上に立つ
    scene.player.position = [0, 1.05, 0];
    scene.player.grounded = true;

    scene.run('PS1', f1ColorCrush, F1_BREAK_TICKS - 1);
    expect(scene.solidOf(F1_VINE_B)).toBe(true);
    scene.run('PS1', f1ColorCrush);
    expect(scene.solidOf(F1_VINE_B)).toBe(false);
    // 撚っていない 1 本では張力が保てないので、緑も落ちる
    expect(scene.solidOf(F1_VINE_A)).toBe(false);
  });

  it('潰れている世代では、同じ場所に立っても切れない（撚られているため）', () => {
    const scene = lab(ids);
    scene.place(F1_VINE_B, [0, 0, 0], [4, 0.25, 0.25]);
    scene.player.position = [0, 1.05, 0];
    scene.player.grounded = true;
    scene.run('FC', f1ColorCrush, F1_BREAK_TICKS + 10);
    expect(scene.solidOf(F1_BRAID)).toBe(true);
  });

  it('揺れるのは撚られていないときだけ（3D でだけ意味を持つ）', () => {
    const scene = lab(ids);
    scene.place(F1_VINE_A, [0, 0, 0.75], [4, 0.25, 0.25]);
    scene.run('PS1', f1ColorCrush, 60);
    expect(scene.positionOf(F1_VINE_A)[2]).not.toBeCloseTo(0.75, 3);

    const still = lab(ids);
    still.place(F1_VINE_A, [0, 0, 0.75], [4, 0.25, 0.25]);
    still.run('FC', f1ColorCrush, 60);
    expect(still.positionOf(F1_VINE_A)[2]).toBeCloseTo(0.75, 6);
  });

  it('台座に触れても、渡れない世代（CH 2）では解けない', () => {
    const scene = lab(ids);
    scene.moveTo(F1_PEDESTAL);
    scene.run('SFC', f1ColorCrush);
    expect(scene.solved).toBe(false);
    scene.run('FC', f1ColorCrush);
    expect(scene.solved).toBe(true);
  });
});

describe('F-2 ちらつきが答えを覗かせる（第1世代）', () => {
  const ids = [...F2_TILE_IDS, ...F2_LAMP_IDS, ...F2_SWARM_IDS, F2_PEDESTAL];

  it('走査線の上限が群れの数より少ない世代でのみ解ける', () => {
    expect(solvableSet(f2FlickerGap)).toEqual(['FC']);
    expect(PROFILES.FC.video.spritesPerScanline).toBeLessThan(F2_SWARM_COUNT);
    expect(PROFILES.SFC.video.spritesPerScanline).toBeGreaterThan(F2_SWARM_COUNT);
  });

  it('正解の道は必ず渡り切れる（行き止まりを作らない）', () => {
    for (let seed = 0; seed < 200; seed++) {
      const safe = routeOf(seed);
      expect(safe).toHaveLength(F2_SAFE_COUNT);
      // 石の番号は 1..N の昇順で、歩幅は 3 石まで
      let previous = 0;
      for (const tile of safe) {
        expect(tile).toBeGreaterThan(previous);
        expect(tile - previous).toBeLessThanOrEqual(3);
        previous = tile;
      }
      // 最後の石から向こう岸までも 3 石以内
      expect(F2_TILE_COUNT + 1 - previous).toBeLessThanOrEqual(3);
    }
  });

  it('試行ごとに正解が変わる（覚えても解けない。決定 3）', () => {
    const routes = new Set([...Array(60).keys()].map((seed) => routeOf(seed).join(',')));
    expect(routes.size).toBeGreaterThan(10);
    // 同じ種からは必ず同じ道（不変条件 I4）
    expect(routeOf(7)).toEqual(routeOf(7));
  });

  it('偽の石は触れると崩れ、本物は残る', () => {
    const scene = lab(ids);
    const safe = routeOf(scene.ctx.attemptSeed);
    const fake = F2_TILE_IDS.findIndex((_, index) => !safe.includes(index + 1));
    scene.run('FC', f2FlickerGap);
    scene.moveTo(F2_TILE_IDS[fake]!);
    scene.run('FC', f2FlickerGap);
    expect(scene.solidOf(F2_TILE_IDS[fake]!)).toBe(false);
    expect(scene.solidOf(F2_TILE_IDS[safe[0]! - 1]!)).toBe(true);
  });

  it('やり直すと崩れた石が戻る（試行が変わるため）', () => {
    const scene = lab(ids);
    scene.run('FC', f2FlickerGap);
    const safe = routeOf(scene.ctx.attemptSeed);
    const fake = F2_TILE_IDS.findIndex((_, index) => !safe.includes(index + 1));
    scene.moveTo(F2_TILE_IDS[fake]!);
    scene.run('FC', f2FlickerGap);
    expect(scene.solidOf(F2_TILE_IDS[fake]!)).toBe(false);

    scene.player.position = [-1000, 0, 0];
    scene.setAttempt(99);
    scene.run('FC', f2FlickerGap);
    expect(scene.solidOf(F2_TILE_IDS[fake]!)).toBe(true);
  });

  it('灯は本物の石の真上に来る（これが答えそのもの）', () => {
    const scene = lab(ids);
    F2_TILE_IDS.forEach((id, index) => scene.place(id, [index + 1, 0, 0], [0.25, 0.25, 2]));
    scene.run('FC', f2FlickerGap);
    const safe = routeOf(scene.ctx.attemptSeed);
    F2_LAMP_IDS.forEach((lampId, index) => {
      expect(scene.positionOf(lampId)[0]).toBeCloseTo(safe[index]!, 6);
    });
  });

  it('群れは漂う（あふれる組が入れ替わり、幕がちらつく）', () => {
    const scene = lab(ids);
    const before = F2_SWARM_IDS.map((id) => scene.positionOf(id)[1]);
    scene.run('FC', f2FlickerGap, 40);
    const after = F2_SWARM_IDS.map((id) => scene.positionOf(id)[1]);
    expect(after.some((y, index) => Math.abs(y - before[index]!) > 0.1)).toBe(true);
  });

  it('あふれない世代では台座に触れても解けない', () => {
    const scene = lab(ids);
    scene.moveTo(F2_PEDESTAL);
    scene.run('PS2', f2FlickerGap);
    expect(scene.solved).toBe(false);
    scene.run('FC', f2FlickerGap);
    expect(scene.solved).toBe(true);
  });
});

describe('S-1 回る床（第2世代）', () => {
  const ids = [S1_PIVOT, S1_ISLAND, S1_PEDESTAL, S1_PLATFORM];

  function circle() {
    const scene = lab(ids);
    scene.place(S1_PIVOT, [0, 0, 0], [0.25, 0.25, 0.25]);
    scene.place(S1_ISLAND, [3, 0, 0], [1.5, 0.25, 1.5]);
    scene.place(S1_PEDESTAL, [3, 1, 0], [0.5, 0.5, 0.5]);
    return scene;
  }

  it('面を回せて、かつ半透明が見える世代でのみ解ける（第2世代のみ）', () => {
    expect(solvableSet(s1AffinePlane)).toEqual(['SFC']);
  });

  it('面が回る世代では島が軸のまわりを公転する', () => {
    const scene = circle();
    scene.run('SFC', s1AffinePlane);
    // 角度 0 では岸側（-X）
    expect(scene.positionOf(S1_ISLAND)[0]).toBeCloseTo(-3, 6);
    scene.run('SFC', s1AffinePlane, S1_PERIOD_TICKS / 4);
    // 4 分の 1 周で真横（+Z）
    expect(scene.positionOf(S1_ISLAND)[2]).toBeCloseTo(3, 1);
  });

  it('回らない世代では向こう側で止まったまま（届かない）', () => {
    const scene = circle();
    for (const generation of ['FC', 'PS1', 'PS2'] as const) {
      scene.run(generation, s1AffinePlane, 120);
      expect(scene.positionOf(S1_ISLAND)[0], generation).toBeCloseTo(3, 6);
    }
  });

  it('台座は島に載っているので一緒に動く', () => {
    const scene = circle();
    scene.run('SFC', s1AffinePlane, 90);
    const island = scene.positionOf(S1_ISLAND);
    const pedestal = scene.positionOf(S1_PEDESTAL);
    expect(pedestal[0]).toBeCloseTo(island[0], 6);
    expect(pedestal[2]).toBeCloseTo(island[2], 6);
  });

  it('島に立っているプレイヤーは島と一緒に運ばれる', () => {
    const scene = circle();
    scene.run('SFC', s1AffinePlane);
    const island = scene.positionOf(S1_ISLAND);
    scene.player.position = [island[0], island[1] + 1.05, island[2]];
    scene.player.grounded = true;
    const before: Vec3 = [...scene.player.position] as Vec3;
    scene.run('SFC', s1AffinePlane, 30);
    const moved = Math.hypot(scene.player.position[0] - before[0], scene.player.position[2] - before[2]);
    expect(moved).toBeGreaterThan(0.1);
    // 足元の島と同じだけ動いている
    const after = scene.positionOf(S1_ISLAND);
    expect(scene.player.position[0] - after[0]).toBeCloseTo(before[0] - island[0], 6);
  });

  it('踏み台は加算合成を持つ世代でだけ実体になる', () => {
    const scene = circle();
    scene.run('FC', s1AffinePlane);
    expect(scene.solidOf(S1_PLATFORM)).toBe(false);
    scene.run('SFC', s1AffinePlane);
    expect(scene.solidOf(S1_PLATFORM)).toBe(true);
  });

  it('角度は周期的で決定的（描画とパズルが同じ値を見る。不変条件 I4）', () => {
    expect(planeAngleAt(0)).toBeCloseTo(0, 6);
    expect(planeAngleAt(S1_PERIOD_TICKS)).toBeCloseTo(0, 6);
    expect(planeAngleAt(S1_PERIOD_TICKS / 2)).toBeCloseTo(Math.PI, 6);
  });
});

describe('P1-1 裏側（奥行きのある世代）', () => {
  it('透視投影の世代でのみ解ける', () => {
    expect(solvableSet(p1BackSide)).toEqual(['PS1', 'PS2']);
  });

  it('2D の世代ではスイッチに重なっても反応しない', () => {
    const scene = lab([P1_1_SWITCH]);
    scene.moveTo(P1_1_SWITCH);
    scene.run('FC', p1BackSide);
    expect(scene.solved).toBe(false);
    scene.run('PS1', p1BackSide);
    expect(scene.solved).toBe(true);
  });
});

describe('P1-2 ソートの破れ（第3世代）', () => {
  it('奥行きがあり、かつ深度バッファを持たない世代でのみ解ける', () => {
    expect(solvableSet(p1SortBreak)).toEqual(['PS1']);
    // 2D の世代も深度バッファを持たないが、奥行きが無いので該当しない
    expect(PROFILES.FC.video.depthBuffer).toBe(false);
    expect(p1SortBreak.solvableIn(PROFILES.FC)).toBe(false);
  });

  it('破れている世代では継ぎ目だけが通れるようになる（殻の他の面は壁のまま）', () => {
    const scene = lab([P1_2_SHELL, P1_2_SEAM, P1_2_CORE]);
    scene.run('PS2', p1SortBreak);
    expect(scene.solidOf(P1_2_SEAM)).toBe(true);
    scene.run('PS1', p1SortBreak);
    expect(scene.solidOf(P1_2_SEAM)).toBe(false);
  });
});

describe('P2-1 暗闇と松明（第4世代）', () => {
  const ids = [...P2_1_SLAB_IDS, P2_1_MARK];

  it('動的ライティングを持つ世代でのみ解ける', () => {
    expect(solvableSet(p2Torch)).toEqual(['PS2']);
  });

  it('渡り廊下は必ず繋がる（隣の板との差は 1 レーンまで）', () => {
    for (let seed = 0; seed < 200; seed++) {
      const lanes = causewayOf(seed);
      expect(lanes).toHaveLength(P2_1_SLAB_COUNT);
      lanes.forEach((lane, index) => {
        expect(lane).toBeGreaterThanOrEqual(0);
        expect(lane).toBeLessThan(P2_1_LANE_Z.length);
        if (index > 0) expect(Math.abs(lane - lanes[index - 1]!)).toBeLessThanOrEqual(1);
      });
    }
  });

  it('試行ごとに形が変わる（決定 3）', () => {
    const shapes = new Set([...Array(60).keys()].map((seed) => causewayOf(seed).join(',')));
    expect(shapes.size).toBeGreaterThan(10);
    expect(causewayOf(3)).toEqual(causewayOf(3));
  });

  it('板は Z だけが動き、X と Y はレベルデータのまま', () => {
    const scene = lab(ids);
    P2_1_SLAB_IDS.forEach((id, index) => scene.place(id, [99 + 2 * index, -4.25, 0], [1, 0.25, 1.5]));
    scene.run('PS2', p2Torch);
    P2_1_SLAB_IDS.forEach((id, index) => {
      const position = scene.positionOf(id);
      expect(position[0]).toBeCloseTo(99 + 2 * index, 6);
      expect(position[1]).toBeCloseTo(-4.25, 6);
      expect(P2_1_LANE_Z).toContain(position[2]);
    });
  });

  it('松明が無い世代では、刻印を踏んでも反応しない（総当たり対策）', () => {
    const scene = lab(ids);
    scene.moveTo(P2_1_MARK);
    for (const id of ['FC', 'SFC', 'PS1'] as const) {
      scene.run(id, p2Torch);
      expect(scene.solved).toBe(false);
    }
    scene.run('PS2', p2Torch);
    expect(scene.solved).toBe(true);
  });
});
