/**
 * レベルデータの型とバリデータ（IMPLEMENTATION_PLAN §5.9 / §7.3、T1-07）。
 *
 * GAME_PLAN §11.4 の「レベルデータは 3D の真実を 1 つだけ持つ」を**形式で保証する**。
 *
 * - 2D 用の座標・当たり判定を持つフィールドを型に定義しない
 * - さらにバリデータが**未知のキーを拒否する**ので、`position2d` のような
 *   抜け道を後から足せない。世代ごとの見え方は投影の結果であって、データではない
 *
 * このファイルは `level/` にあるため core/ と generation/ にしか依存できない（§4.2）。
 * パズルの世代検証（§7.3）は定義そのものを引数で受け取り、gameplay/ へは依存しない。
 */
import { GENERATION_IDS, PROFILES, type GenerationId } from '@/generation/profiles';

export const LEVEL_VERSION = 1;

/**
 * ワールド単位と画素の対応（**本書で新たに定める**）。
 *
 * 第1世代のタイルは 8 画素（`PROFILES.FC.video.tileSnap`）。これを 0.25 ワールド単位に
 * 対応させると、第1世代の移動グリッド（`action.moveSnap = 0.25`）とちょうど一致し、
 * 「1 タイル分だけ正確に動いて止まれる」が座標系のレベルで揃う。
 */
export const PIXELS_PER_WORLD_UNIT = 32;

/** 第1世代のタイル 1 枚のワールド単位（= 8px / 32）。レベル要素はこの倍数に揃える */
export const FC_GRID_WORLD = PROFILES.FC.video.tileSnap / PIXELS_PER_WORLD_UNIT;

export type Vec3Tuple = [number, number, number];
export type Vec4Tuple = [number, number, number, number];

export interface LevelTransform {
  position: Vec3Tuple;
  /** 四元数。省略時は無回転 */
  rotation?: Vec4Tuple;
  /** 省略時は等倍 */
  scale?: Vec3Tuple;
}

export interface LevelCollider {
  type: 'aabb';
  halfExtents: Vec3Tuple;
  /** false なら通り抜ける（ゴール・トリガ領域）。省略時は true */
  solid?: boolean;
}

export interface LevelEntity {
  id: string;
  type: string;
  transform: LevelTransform;
  collider?: LevelCollider;
  model?: string;
  /** 所属セクタ（カリング単位）。sectors の id を指す */
  sector: string;
}

export interface LevelSector {
  id: string;
  center: Vec3Tuple;
  halfExtents: Vec3Tuple;
  /** 隣接セクタ（無向）。到達可能性の静的検査に使う */
  links: string[];
}

export interface PuzzlePlacement {
  /** gameplay/puzzles/registry.ts のキー */
  puzzleId: string;
  /** このパズルが解ける世代。CI が solvableIn を 4 世代で評価して照合する */
  requiredGenerations: GenerationId[];
  entities: string[];
}

export interface LevelCheckpoint {
  id: string;
  position: Vec3Tuple;
  sector: string;
}

export interface LevelFile {
  version: typeof LEVEL_VERSION;
  id: string;
  sectors: LevelSector[];
  entities: LevelEntity[];
  puzzles: PuzzlePlacement[];
  checkpoints: LevelCheckpoint[];
  spawn: { position: Vec3Tuple; facing: number; sector: string };
}

export interface ValidationIssue {
  path: string;
  message: string;
}

// --- 小さな検査ヘルパ（実行時依存を増やさないため手書きする。§1.3） ---

const ENTITY_KEYS = new Set(['id', 'type', 'transform', 'collider', 'model', 'sector']);
const TRANSFORM_KEYS = new Set(['position', 'rotation', 'scale']);
const COLLIDER_KEYS = new Set(['type', 'halfExtents', 'solid']);
const SECTOR_KEYS = new Set(['id', 'center', 'halfExtents', 'links']);
const PUZZLE_KEYS = new Set(['puzzleId', 'requiredGenerations', 'entities']);
const CHECKPOINT_KEYS = new Set(['id', 'position', 'sector']);
const SPAWN_KEYS = new Set(['position', 'facing', 'sector']);
const ROOT_KEYS = new Set(['version', 'id', 'sectors', 'entities', 'puzzles', 'checkpoints', 'spawn']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVec3(value: unknown): value is Vec3Tuple {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

export function createValidator(): { issues: ValidationIssue[]; fail(path: string, message: string): void } {
  const issues: ValidationIssue[] = [];
  return {
    issues,
    fail(path, message): void {
      issues.push({ path, message });
    },
  };
}

/** 未知のキーを拒否する。2D 用フィールドの後付けを形式で防ぐ（§5.9） */
function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  fail: (path: string, message: string) => void,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, '未知のフィールド（2D 用の座標・当たり判定は定義できない）');
  }
}

/** グリッド整列。第1世代のタイル（8px = 0.25 ワールド単位）に載っているか */
export function isOnFcGrid(value: number): boolean {
  const scaled = value / FC_GRID_WORLD;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

function checkGrid(values: Vec3Tuple, path: string, fail: (path: string, message: string) => void): void {
  values.forEach((value, axis) => {
    if (!isOnFcGrid(value)) {
      fail(`${path}[${axis}]`, `第1世代の ${FC_GRID_WORLD} 単位グリッドに載っていない: ${value}`);
    }
  });
}

/**
 * スキーマ・参照整合性・グリッド整列・到達可能性を検査する（§5.9 の検査 1・3・4）。
 * パズルの世代検証（検査 2）は定義が要るため `checkPuzzleGenerations` に分ける。
 */
export function validateLevel(data: unknown): { level: LevelFile | null; issues: ValidationIssue[] } {
  const { issues, fail } = createValidator();

  if (!isRecord(data)) {
    fail('', 'ルートがオブジェクトではない');
    return { level: null, issues };
  }
  rejectUnknownKeys(data, ROOT_KEYS, '', fail);

  if (data['version'] !== LEVEL_VERSION) fail('version', `未知の version: ${String(data['version'])}`);
  if (typeof data['id'] !== 'string' || data['id'] === '') fail('id', 'id が無い');

  // --- セクタ ---
  const sectors = new Map<string, LevelSector>();
  const rawSectors = Array.isArray(data['sectors']) ? data['sectors'] : [];
  if (!Array.isArray(data['sectors'])) fail('sectors', '配列ではない');
  rawSectors.forEach((raw: unknown, index: number) => {
    const path = `sectors[${index}]`;
    if (!isRecord(raw)) return fail(path, 'オブジェクトではない');
    rejectUnknownKeys(raw, SECTOR_KEYS, path, fail);
    const id = raw['id'];
    if (typeof id !== 'string' || id === '') return fail(`${path}.id`, 'id が無い');
    if (sectors.has(id)) fail(`${path}.id`, `セクタ id が重複している: ${id}`);
    if (!isVec3(raw['center'])) fail(`${path}.center`, '3 要素の数値配列ではない');
    if (!isVec3(raw['halfExtents'])) fail(`${path}.halfExtents`, '3 要素の数値配列ではない');
    const links = raw['links'];
    if (!Array.isArray(links) || links.some((l) => typeof l !== 'string')) {
      fail(`${path}.links`, '文字列の配列ではない');
    }
    if (isVec3(raw['center']) && isVec3(raw['halfExtents'])) {
      sectors.set(id, {
        id,
        center: raw['center'],
        halfExtents: raw['halfExtents'],
        links: Array.isArray(links) ? (links as string[]) : [],
      });
    }
  });

  for (const sector of sectors.values()) {
    for (const link of sector.links) {
      if (!sectors.has(link)) fail(`sectors.${sector.id}.links`, `未定義のセクタを指している: ${link}`);
    }
  }

  // --- エンティティ ---
  const entities = new Map<string, LevelEntity>();
  const rawEntities = Array.isArray(data['entities']) ? data['entities'] : [];
  if (!Array.isArray(data['entities'])) fail('entities', '配列ではない');
  rawEntities.forEach((raw: unknown, index: number) => {
    const path = `entities[${index}]`;
    if (!isRecord(raw)) return fail(path, 'オブジェクトではない');
    rejectUnknownKeys(raw, ENTITY_KEYS, path, fail);

    const id = raw['id'];
    if (typeof id !== 'string' || id === '') return fail(`${path}.id`, 'id が無い');
    if (entities.has(id)) fail(`${path}.id`, `エンティティ id が重複している: ${id}`);
    if (typeof raw['type'] !== 'string') fail(`${path}.type`, 'type が無い');

    const sector = raw['sector'];
    if (typeof sector !== 'string') fail(`${path}.sector`, 'sector が無い');
    else if (!sectors.has(sector)) fail(`${path}.sector`, `未定義のセクタ: ${sector}`);

    const transform = raw['transform'];
    if (!isRecord(transform)) return fail(`${path}.transform`, 'transform が無い');
    rejectUnknownKeys(transform, TRANSFORM_KEYS, `${path}.transform`, fail);
    if (!isVec3(transform['position'])) fail(`${path}.transform.position`, '3 要素の数値配列ではない');
    else checkGrid(transform['position'], `${path}.transform.position`, fail);
    if (transform['scale'] !== undefined && !isVec3(transform['scale'])) {
      fail(`${path}.transform.scale`, '3 要素の数値配列ではない');
    }

    const collider = raw['collider'];
    if (collider !== undefined) {
      if (!isRecord(collider)) return fail(`${path}.collider`, 'オブジェクトではない');
      rejectUnknownKeys(collider, COLLIDER_KEYS, `${path}.collider`, fail);
      if (collider['type'] !== 'aabb') fail(`${path}.collider.type`, "'aabb' のみ対応する");
      if (!isVec3(collider['halfExtents'])) fail(`${path}.collider.halfExtents`, '3 要素の数値配列ではない');
      else checkGrid(collider['halfExtents'], `${path}.collider.halfExtents`, fail);
      if (collider['solid'] !== undefined && typeof collider['solid'] !== 'boolean') {
        fail(`${path}.collider.solid`, '真偽値ではない');
      }
    }

    if (typeof id === 'string' && isRecord(transform) && isVec3(transform['position'])) {
      entities.set(id, raw as unknown as LevelEntity);
    }
  });

  // --- パズル配置 ---
  const rawPuzzles = Array.isArray(data['puzzles']) ? data['puzzles'] : [];
  if (!Array.isArray(data['puzzles'])) fail('puzzles', '配列ではない');
  rawPuzzles.forEach((raw: unknown, index: number) => {
    const path = `puzzles[${index}]`;
    if (!isRecord(raw)) return fail(path, 'オブジェクトではない');
    rejectUnknownKeys(raw, PUZZLE_KEYS, path, fail);
    if (typeof raw['puzzleId'] !== 'string') fail(`${path}.puzzleId`, 'puzzleId が無い');

    const required = raw['requiredGenerations'];
    if (!Array.isArray(required) || required.length === 0) {
      fail(`${path}.requiredGenerations`, '1 つ以上の世代が要る');
    } else {
      for (const generation of required) {
        if (!GENERATION_IDS.includes(generation as GenerationId)) {
          fail(`${path}.requiredGenerations`, `未知の世代: ${String(generation)}`);
        }
      }
    }

    const used = raw['entities'];
    if (!Array.isArray(used)) fail(`${path}.entities`, '配列ではない');
    else {
      for (const entityId of used) {
        if (typeof entityId !== 'string' || !entities.has(entityId)) {
          fail(`${path}.entities`, `未定義のエンティティを指している: ${String(entityId)}`);
        }
      }
    }
  });

  // --- チェックポイントと出現位置 ---
  const checkpointSectors: string[] = [];
  const rawCheckpoints = Array.isArray(data['checkpoints']) ? data['checkpoints'] : [];
  if (!Array.isArray(data['checkpoints'])) fail('checkpoints', '配列ではない');
  rawCheckpoints.forEach((raw: unknown, index: number) => {
    const path = `checkpoints[${index}]`;
    if (!isRecord(raw)) return fail(path, 'オブジェクトではない');
    rejectUnknownKeys(raw, CHECKPOINT_KEYS, path, fail);
    if (typeof raw['id'] !== 'string') fail(`${path}.id`, 'id が無い');
    if (!isVec3(raw['position'])) fail(`${path}.position`, '3 要素の数値配列ではない');
    const sector = raw['sector'];
    if (typeof sector !== 'string') fail(`${path}.sector`, 'sector が無い');
    else if (!sectors.has(sector)) fail(`${path}.sector`, `未定義のセクタ: ${sector}`);
    else checkpointSectors.push(sector);
  });

  const spawn = data['spawn'];
  let spawnSector: string | null = null;
  if (!isRecord(spawn)) fail('spawn', 'spawn が無い');
  else {
    rejectUnknownKeys(spawn, SPAWN_KEYS, 'spawn', fail);
    if (!isVec3(spawn['position'])) fail('spawn.position', '3 要素の数値配列ではない');
    if (typeof spawn['facing'] !== 'number') fail('spawn.facing', '数値ではない');
    if (typeof spawn['sector'] !== 'string') fail('spawn.sector', 'sector が無い');
    else if (!sectors.has(spawn['sector'])) fail('spawn.sector', `未定義のセクタ: ${spawn['sector']}`);
    else spawnSector = spawn['sector'];
  }

  // --- 到達可能性（§5.9 の検査 3） ---
  // 物理的な到達判定ではなく、セクタの接続グラフとして検査する。
  // 「出現位置のセクタからすべてのチェックポイントのセクタへ辿れること」を保証する。
  if (spawnSector !== null) {
    const reachable = reachableSectors(sectors, spawnSector);
    for (const sector of new Set(checkpointSectors)) {
      if (!reachable.has(sector)) {
        fail('checkpoints', `出現位置のセクタから到達できない: ${sector}`);
      }
    }
    for (const sector of sectors.keys()) {
      if (!reachable.has(sector)) fail(`sectors.${sector}`, '出現位置のセクタから到達できない（孤立セクタ）');
    }
  }

  return { level: issues.length === 0 ? (data as unknown as LevelFile) : null, issues };
}

/** セクタの接続グラフを無向として辿る */
export function reachableSectors(sectors: ReadonlyMap<string, LevelSector>, from: string): Set<string> {
  const neighbours = new Map<string, Set<string>>();
  for (const sector of sectors.values()) neighbours.set(sector.id, new Set(sector.links));
  for (const sector of sectors.values()) {
    for (const link of sector.links) neighbours.get(link)?.add(sector.id);
  }

  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of neighbours.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** パズル定義のうち、世代検証に必要な部分だけ（gameplay/ へ依存しないための最小形） */
export interface PuzzleGenerationCheck {
  id: string;
  solvableIn(generation: GenerationId): boolean;
}

/**
 * §5.9 の検査 2 / §7.3 の「本作で最も価値のある自動検証」。
 *
 * 各パズル定義の `solvableIn` を **4 世代すべてに対して評価**し、
 * 真になる集合がレベル側の `requiredGenerations` と一致することを確かめる。
 * 「タグ付けされた世代でのみ解ける」を人間のレビューに任せない。
 */
export function checkPuzzleGenerations(
  level: LevelFile,
  definitions: readonly PuzzleGenerationCheck[],
): ValidationIssue[] {
  const { issues, fail } = createValidator();
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));

  for (const placement of level.puzzles) {
    const definition = byId.get(placement.puzzleId);
    if (!definition) {
      fail(`puzzles.${placement.puzzleId}`, '登録されていないパズル ID');
      continue;
    }
    const solvable = GENERATION_IDS.filter((generation) => definition.solvableIn(generation));
    const declared = [...placement.requiredGenerations].sort();
    const actual = [...solvable].sort();
    if (declared.join(',') !== actual.join(',')) {
      fail(
        `puzzles.${placement.puzzleId}.requiredGenerations`,
        `宣言 [${declared.join(', ')}] と solvableIn の評価 [${actual.join(', ')}] が一致しない`,
      );
    }
  }

  return issues;
}
