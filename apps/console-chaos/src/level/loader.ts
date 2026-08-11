/**
 * レベルローダ（IMPLEMENTATION_PLAN §5.9、T1-07）。
 *
 * 読み込みは**必ずバリデータを通す**。CI（`npm run check:levels`）と実行時で
 * 同じ `validateLevel` を使うので、「CI は通ったが実行時に壊れる」が起きない
 *（`tools/gltf-preflight.ts` が実ローダを通すのと同じ考え方）。
 *
 * ここが返すのは検証済みのデータだけで、ワールドへの実体化は行わない。
 * level/ は gameplay/ に依存できない（§4.2）ため、実体化は受け取る側の仕事。
 */
import { validateLevel, type LevelEntity, type LevelFile, type ValidationIssue } from './schema';

export class LevelValidationError extends Error {
  constructor(
    readonly source: string,
    readonly issues: readonly ValidationIssue[],
  ) {
    super(
      `レベル "${source}" が形式に合っていない:\n` +
        issues.map((issue) => `  - ${issue.path === '' ? '(root)' : issue.path}: ${issue.message}`).join('\n'),
    );
    this.name = 'LevelValidationError';
  }
}

/** 解析済みのデータから読む（テストと、埋め込みレベル用） */
export function parseLevel(data: unknown, source = '(inline)'): LevelFile {
  const { level, issues } = validateLevel(data);
  if (!level) throw new LevelValidationError(source, issues);
  return level;
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** URL から読む。取得手段を差し替えられるようにしておく（テスト・将来の同梱形式） */
export async function loadLevel(url: string, fetchImpl?: FetchLike): Promise<LevelFile> {
  const get: FetchLike = fetchImpl ?? ((target) => fetch(target));
  const response = await get(url);
  if (!response.ok) throw new Error(`レベルを取得できない: ${url}（HTTP ${response.status}）`);
  return parseLevel(await response.json(), url);
}

/** 当たり判定を持つ要素だけを取り出す（ワールドへ実体化する側が使う） */
export function collidersOf(level: LevelFile): LevelEntity[] {
  return level.entities.filter((entity) => entity.collider !== undefined);
}

export function entityById(level: LevelFile, id: string): LevelEntity | undefined {
  return level.entities.find((entity) => entity.id === id);
}
