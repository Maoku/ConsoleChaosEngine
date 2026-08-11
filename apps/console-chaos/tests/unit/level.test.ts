import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  FC_GRID_WORLD,
  PIXELS_PER_WORLD_UNIT,
  checkPuzzleGenerations,
  isOnFcGrid,
  validateLevel,
  type LevelFile,
} from '@/level/schema';
import { LevelValidationError, collidersOf, entityById, loadLevel, parseLevel } from '@/level/loader';
import { entitiesInSectors, sectorAt, visibleEntities, visibleSectorIds } from '@/level/sector';
import { PROFILES } from '@/generation/profiles';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MINI_PATH = join(ROOT, 'public/assets/levels/mini.json');
const MINI: unknown = JSON.parse(readFileSync(MINI_PATH, 'utf8'));

/** 検証を通る最小のレベル。各テストで 1 箇所だけ壊す */
function minimal(): Record<string, unknown> {
  return {
    version: 1,
    id: 'test',
    sectors: [
      { id: 'a', center: [0, 0, 0], halfExtents: [5, 5, 5], links: ['b'] },
      { id: 'b', center: [10, 0, 0], halfExtents: [5, 5, 5], links: [] },
    ],
    entities: [
      {
        id: 'floor',
        type: 'platform',
        sector: 'a',
        transform: { position: [0, -0.25, 0] },
        collider: { type: 'aabb', halfExtents: [2.5, 0.25, 1] },
      },
    ],
    puzzles: [],
    checkpoints: [{ id: 'cp', position: [0, 1, 0], sector: 'b' }],
    spawn: { position: [0, 1, 0], facing: 1, sector: 'a' },
  };
}

describe('level/schema の座標系（T1-07 で定めた対応）', () => {
  it('第1世代の 8px タイルが 0.25 ワールド単位に対応する', () => {
    expect(PIXELS_PER_WORLD_UNIT).toBe(32);
    expect(FC_GRID_WORLD).toBe(PROFILES.FC.video.tileSnap / PIXELS_PER_WORLD_UNIT);
    // タイル 1 枚と第1世代の移動グリッドが一致する（1 タイルだけ動いて止まれる）
    expect(FC_GRID_WORLD).toBe(PROFILES.FC.action.moveSnap);
  });

  it('グリッド判定は浮動小数の誤差を許す', () => {
    expect(isOnFcGrid(1.25)).toBe(true);
    expect(isOnFcGrid(-3.5)).toBe(true);
    expect(isOnFcGrid(0.1 + 0.15)).toBe(true);
    expect(isOnFcGrid(1.2)).toBe(false);
  });
});

describe('level/schema のバリデータ（§5.9 の 4 検査）', () => {
  it('同梱のレベルが検証を通る', () => {
    const { level, issues } = validateLevel(MINI);
    expect(issues).toEqual([]);
    expect(level?.id).toBe('mini');
  });

  it('検査 1: 未定義のエンティティを指すパズル配置を弾く', () => {
    const data = minimal();
    data['puzzles'] = [{ puzzleId: 'F-1', requiredGenerations: ['FC'], entities: ['no_such_entity'] }];
    const { issues } = validateLevel(data);
    expect(issues.some((i) => i.message.includes('未定義のエンティティ'))).toBe(true);
  });

  it('検査 1: 未定義のセクタを指す要素を弾く', () => {
    const data = minimal();
    (data['entities'] as Array<Record<string, unknown>>)[0]!['sector'] = 'ghost';
    const { issues } = validateLevel(data);
    expect(issues.some((i) => i.message.includes('未定義のセクタ'))).toBe(true);
  });

  it('検査 3: 到達できないチェックポイントを弾く', () => {
    const data = minimal();
    // a と b の接続を切ると、b のチェックポイントへ辿り着けない
    (data['sectors'] as Array<Record<string, unknown>>)[0]!['links'] = [];
    const { issues } = validateLevel(data);
    expect(issues.some((i) => i.message.includes('到達できない'))).toBe(true);
  });

  it('検査 4: グリッドから外れた要素を弾く', () => {
    const data = minimal();
    const entity = (data['entities'] as Array<Record<string, unknown>>)[0]!;
    (entity['transform'] as Record<string, unknown>)['position'] = [1.2, 0, 0];
    const { issues } = validateLevel(data);
    expect(issues.some((i) => i.message.includes('グリッドに載っていない'))).toBe(true);
  });

  it('2D 用の座標を後から足せない（未知のキーを拒否する）', () => {
    const data = minimal();
    const entity = (data['entities'] as Array<Record<string, unknown>>)[0]!;
    entity['position2d'] = [0, 0];
    const { issues } = validateLevel(data);
    expect(issues.some((i) => i.path.endsWith('position2d'))).toBe(true);

    const withRoot = minimal();
    withRoot['layers2d'] = [];
    expect(validateLevel(withRoot).issues.some((i) => i.path === '.layers2d')).toBe(true);
  });

  it('version が違えば読まない', () => {
    const data = minimal();
    data['version'] = 2;
    expect(validateLevel(data).issues.some((i) => i.path === 'version')).toBe(true);
  });
});

describe('level/schema のパズル世代検証（§7.3 の中核）', () => {
  const level = parseLevel({
    ...minimal(),
    puzzles: [{ puzzleId: 'F-1', requiredGenerations: ['FC'], entities: ['floor'] }],
  });

  it('solvableIn の評価が宣言と一致すれば通る', () => {
    const issues = checkPuzzleGenerations(level as LevelFile, [
      { id: 'F-1', solvableIn: (generation) => generation === 'FC' },
    ]);
    expect(issues).toEqual([]);
  });

  it('宣言していない世代でも解けてしまうなら落ちる', () => {
    const issues = checkPuzzleGenerations(level as LevelFile, [
      { id: 'F-1', solvableIn: (generation) => generation === 'FC' || generation === 'SFC' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('一致しない');
  });

  it('登録されていないパズル ID を弾く', () => {
    const issues = checkPuzzleGenerations(level as LevelFile, []);
    expect(issues[0]?.message).toContain('登録されていない');
  });
});

describe('level/loader', () => {
  it('壊れたデータは例外にする（実行時と CI で同じ判定）', () => {
    expect(() => parseLevel({ version: 1 }, 'broken.json')).toThrow(LevelValidationError);
    try {
      parseLevel({ version: 1 }, 'broken.json');
    } catch (e) {
      expect((e as LevelValidationError).issues.length).toBeGreaterThan(0);
      expect((e as Error).message).toContain('broken.json');
    }
  });

  it('取得手段を差し替えて読める', async () => {
    const level = await loadLevel('mini.json', async () => ({ ok: true, status: 200, json: async () => MINI }));
    expect(level.id).toBe('mini');
  });

  it('取得に失敗したら例外にする', async () => {
    await expect(
      loadLevel('missing.json', async () => ({ ok: false, status: 404, json: async () => ({}) })),
    ).rejects.toThrow('HTTP 404');
  });

  it('当たり判定を持つ要素だけを取り出せる', () => {
    const level = parseLevel(MINI);
    expect(collidersOf(level)).toHaveLength(5);
    expect(entityById(level, 'bridge')?.transform.position).toEqual([0, -0.25, -4]);
    expect(entityById(level, 'nope')).toBeUndefined();
  });
});

describe('level/sector（手動セクタ分割）', () => {
  const level = parseLevel(MINI);

  it('位置からセクタが決まる', () => {
    expect(sectorAt(level, [-5, 1, 0])?.id).toBe('start');
    expect(sectorAt(level, [4, 0, -4])?.id).toBe('far');
    expect(sectorAt(level, [100, 0, 0])).toBeNull();
  });

  it('表示対象は「今いるセクタ + 隣接」', () => {
    expect(visibleSectorIds(level, 'start')).toEqual(['start', 'far']);
    expect(entitiesInSectors(level, ['far']).map((e) => e.id)).toEqual(['far_platform', 'goal']);
  });

  it('セクタが決まらない位置では全件を返す（安全側に倒す）', () => {
    expect(visibleEntities(level, [100, 0, 0])).toHaveLength(level.entities.length);
  });
});
