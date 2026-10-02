import { GENERATION_IDS, HARDWARE_GENERATION_PROFILES, type GenerationId } from '@console-chaos/engine';
import { validateLevel, type LevelFile } from '@/level/schema';
import { LevelValidationError, type FetchLike } from '@/level/loader';
import { stageCompletionIn } from './stage-capabilities';

export const STAGE_VERSION = 2;
export const PUZZLE_ROLES = {
  'F-1': ['braid', 'vineA', 'vineB', 'terminal'],
  'F-2': ['tiles', 'lamps', 'swarm', 'terminal'],
  'S-1': ['pivot', 'island', 'step', 'terminal'],
  'P1-1': ['wall', 'terminal'],
  'P1-2': ['seam', 'terminal'],
  'P2-1': ['slabs', 'terminal'],
} as const;
export type PuzzleKind = keyof typeof PUZZLE_ROLES;
export interface StagePuzzle {
  id: string;
  kind: PuzzleKind;
  variant: 'crossing' | 'connection';
  bindings: Record<string, string | string[]>;
  settings: Record<string, number>;
  achievement: string;
  hintGenerations: GenerationId[];
  completionGenerations: GenerationId[];
  hints: [string, string, string, string];
  signals?: string[];
}
export interface StageFile {
  version: typeof STAGE_VERSION;
  id: string;
  title: string;
  tagline: string;
  scene: LevelFile;
  instances: StagePuzzle[];
  exit: { goal: string; blocker: string; requires: string[] };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((x) => typeof x === 'string' && x.trim() !== '');
}
const SETTINGS: Record<PuzzleKind, readonly string[]> = {
  'F-1': [], 'F-2': ['safeCount'], 'S-1': ['periodTicks', 'scaleAmplitude'],
  'P1-1': [], 'P1-2': [], 'P2-1': ['lightThreshold'],
};

/** v2 metadata is app-owned; the scene retains one v1 3D coordinate source. */
export function parseStage(data: unknown, source = '(inline)'): StageFile {
  const issues: Array<{ path: string; message: string }> = [];
  const fail = (path: string, message: string): void => { issues.push({ path, message }); };
  const keys = (value: Record<string, unknown>, allowed: readonly string[], path: string): void => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(path + '.' + key, '未知のフィールド');
  };
  if (!record(data)) throw new LevelValidationError(source, [{ path: '', message: 'ステージがオブジェクトではない' }]);
  keys(data, ['version', 'id', 'title', 'tagline', 'scene', 'instances', 'exit'], '');
  if (data.version !== STAGE_VERSION) fail('version', 'ステージversionは2');
  for (const key of ['id', 'title', 'tagline']) {
    if (typeof data[key] !== 'string' || (data[key] as string).trim() === '') fail(key, '空ではない文字列が必要');
  }
  const sceneResult = validateLevel(data.scene);
  for (const issue of sceneResult.issues) fail('scene.' + issue.path, issue.message);
  const scene = sceneResult.level;
  if (scene && (scene.id !== data.id || scene.puzzles.length !== 0)) fail('scene', 'idを揃え、パズルはinstancesへ置く');
  const entities = new Map(scene?.entities.map((entity) => [entity.id, entity]) ?? []);
  const ids = new Set<string>();
  const achievements = new Set<string>();
  const boundEntities = new Map<string, string>();
  if (!Array.isArray(data.instances) || data.instances.length === 0) fail('instances', '一つ以上の配置が必要');
  for (const [index, raw] of (Array.isArray(data.instances) ? data.instances : []).entries()) {
    const path = 'instances[' + index + ']';
    if (!record(raw)) { fail(path, '配置がオブジェクトではない'); continue; }
    keys(raw, ['id', 'kind', 'variant', 'bindings', 'settings', 'achievement', 'hintGenerations', 'completionGenerations', 'hints', 'signals'], path);
    if (raw.signals !== undefined) {
      if (!strings(raw.signals)) fail(path + '.signals', '導線entityの参照が必要');
      else for (const id of raw.signals) if (!entities.has(id)) fail(path + '.signals', '未知の導線: ' + id);
    }
    for (const [key, used] of [['id', ids], ['achievement', achievements]] as const) {
      const value = raw[key];
      if (typeof value !== 'string' || value.trim() === '' || used.has(value)) fail(path + '.' + key, '空または重複したID');
      else used.add(value);
    }
    if (typeof raw.kind !== 'string' || !Object.hasOwn(PUZZLE_ROLES, raw.kind)) { fail(path + '.kind', '未知の種類'); continue; }
    const kind = raw.kind as PuzzleKind;
    if (!['crossing', 'connection'].includes(String(raw.variant))) fail(path + '.variant', '未知のvariant');
    if (!record(raw.bindings)) fail(path + '.bindings', 'role bindingが必要');
    else {
      keys(raw.bindings, PUZZLE_ROLES[kind], path + '.bindings');
      for (const role of PUZZLE_ROLES[kind]) {
        const value = raw.bindings[role];
        const listRole = ['tiles', 'lamps', 'swarm', 'slabs'].includes(role);
        const refs = typeof value === 'string' ? [value] : strings(value) ? value : [];
        if (refs.length === 0 || listRole !== Array.isArray(value)) fail(path + '.bindings.' + role, 'roleの形式が不正');
        if (new Set(refs).size !== refs.length) fail(path + '.bindings.' + role, '参照が重複');
        for (const ref of refs) {
          if (!entities.get(ref)?.collider) fail(path + '.bindings.' + role, 'collider付きentityが必要: ' + ref);
          const owner = boundEntities.get(ref);
          if (owner) fail(path + '.bindings.' + role, '別roleへ重複した実体: ' + ref + ' (' + owner + ')');
          else boundEntities.set(ref, path + '.' + role);
        }
      }
      if (kind === 'F-2') {
        const tiles = raw.bindings.tiles;
        const lamps = raw.bindings.lamps;
        const swarm = raw.bindings.swarm;
        const safe = record(raw.settings) ? raw.settings.safeCount : undefined;
        if (!Array.isArray(swarm) || swarm.length <= 8 || !Array.isArray(tiles) || !Array.isArray(lamps) || !Number.isInteger(safe) || Number(safe) < 1 ||
            Number(safe) >= tiles.length || lamps.length !== safe || tiles.length + 1 > (Number(safe) + 1) * 3) {
          fail(path, '群れは9体以上、石数・正解数・灯数が一致し、3石以内の跳躍で経路が成立する必要がある');
        }
      }
    }
    if (!record(raw.settings)) fail(path + '.settings', '設定が必要');
    else {
      keys(raw.settings, SETTINGS[kind], path + '.settings');
      for (const [key, value] of Object.entries(raw.settings)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) fail(path + '.settings.' + key, '有限数が必要');
        if (key === 'periodTicks' && (!Number.isInteger(value) || Number(value) < 180)) fail(path, '周期は180tick以上');
        if (key === 'scaleAmplitude' && (Number(value) < 0 || Number(value) > 0.1)) fail(path, '拡縮は0〜0.1');
        if (key === 'lightThreshold' && (Number(value) <= 0 || Number(value) >= 1)) fail(path, '光閾値は0と1の間');
      }
    }
    for (const key of ['hintGenerations', 'completionGenerations']) {
      const values = raw[key];
      if (!strings(values) || new Set(values).size !== values.length || values.some((value) => !GENERATION_IDS.includes(value as GenerationId))) {
        fail(path + '.' + key, '世代の一意な集合が必要');
      }
    }
    if (strings(raw.completionGenerations)) {
      const expected = GENERATION_IDS.filter((id) => stageCompletionIn({ kind, variant: raw.variant as StagePuzzle['variant'] }, HARDWARE_GENERATION_PROFILES[id]));
      if ([...raw.completionGenerations].sort().join() !== [...expected].sort().join()) fail(path + '.completionGenerations', '成果条件と世代宣言が一致しない');
    }
    if (!strings(raw.hints) || raw.hints.length !== 4) fail(path + '.hints', '4段階のヒントが必要');
  }
  if (!record(data.exit)) fail('exit', '出口が必要');
  else {
    keys(data.exit, ['goal', 'blocker', 'requires'], 'exit');
    for (const key of ['goal', 'blocker']) {
      const entity = entities.get(String(data.exit[key]));
      if (!entity?.collider || (key === 'goal' && (entity.type !== 'goal' || entity.collider.solid !== false))) {
        fail('exit.' + key, '有効な出口entityが必要');
      }
    }
    if (data.exit.goal === data.exit.blocker) fail('exit', 'triggerとblockerを分離する');
    if (!strings(data.exit.requires) || new Set(data.exit.requires).size !== data.exit.requires.length) fail('exit.requires', '必要成果の一意な集合が必要');
    else for (const id of data.exit.requires) if (!achievements.has(id)) fail('exit.requires', '未知の成果: ' + id);
  }
  if (issues.length) throw new LevelValidationError(source, issues);
  return data as unknown as StageFile;
}

export async function loadStage(url: string, fetchImpl: FetchLike = (target) => fetch(target)): Promise<StageFile> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error('ステージを取得できない: ' + url + ' (HTTP ' + response.status + ')');
  return parseStage(await response.json(), url);
}

export function stageLevel(stage: StageFile): LevelFile {
  return {
    ...stage.scene,
    puzzles: stage.instances.map((instance) => ({
      puzzleId: instance.id,
      requiredGenerations: instance.hintGenerations,
      entities: Object.values(instance.bindings).flat(),
    })),
  };
}
