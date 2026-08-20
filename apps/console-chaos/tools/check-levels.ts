/**
 * レベル・パズルのバリデータ（IMPLEMENTATION_PLAN §5.9 / §7.3、T1-07）。
 *
 * §5.9 が求める 4 つの検査をここで回す:
 *   1. スキーマ適合と参照整合性（entities の ID 解決、puzzleId の存在）
 *   2. requiredGenerations に挙げられていない世代でパズルが解けてしまわないこと
 *   3. すべてのチェックポイントが到達可能であること（セクタ接続グラフの静的検査）
 *   4. 第1世代で使うレベル要素が 8px グリッド（= 0.25 ワールド単位）に整列していること
 *   5. 装飾の材質と「collider を持たないこと」が同値であること（SG-05）
 *
 * 1・3・4 は実行時と同じ `src/level/schema.ts` を通す。CI と実行時で判定がずれない。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkPuzzleGenerations, validateLevel, FC_GRID_WORLD, type ValidationIssue } from '../src/level/schema';
import { generationChecks } from '../src/gameplay/puzzles/registry';
import { checkPuzzleCatalog } from '../src/gameplay/puzzles/catalog';
import { materialFor } from '../src/render/material';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEVEL_DIR = join(ROOT, 'public/assets/levels');

function report(file: string, issues: readonly ValidationIssue[]): void {
  for (const issue of issues) {
    console.error(`  ✗ ${file}: ${issue.path === '' ? '(root)' : issue.path} — ${issue.message}`);
  }
}

if (!existsSync(LEVEL_DIR)) {
  console.log('✓ レベル検査: ディレクトリ未作成（検査対象 0 件）');
  process.exit(0);
}

const files = readdirSync(LEVEL_DIR).filter((f) => f.endsWith('.json'));
const puzzles = generationChecks();
let failed = false;

for (const file of files) {
  const abs = join(LEVEL_DIR, file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    failed = true;
    console.error(`  ✗ ${file}: JSON として読めない（${(e as Error).message}）`);
    continue;
  }

  // 検査 1・3・4
  const { level, issues } = validateLevel(parsed);
  if (!level) {
    failed = true;
    report(file, issues);
    continue;
  }

  // 検査 2：パズル定義の solvableIn を 4 世代すべてで評価して照合する
  const puzzleIssues = checkPuzzleGenerations(level, puzzles);
  if (puzzleIssues.length > 0) {
    failed = true;
    report(file, puzzleIssues);
    continue;
  }

  // 検査 2b：配置された謎は名称と段階 3・4 の固有ヒントを必ず持つ。
  const catalogIssues: ValidationIssue[] = checkPuzzleCatalog(level.puzzles.map(({ puzzleId }) => puzzleId))
    .map((issue) => ({ path: `puzzles.${issue.puzzleId}`, message: issue.message }));
  if (catalogIssues.length > 0) {
    failed = true;
    report(file, catalogIssues);
    continue;
  }

  // 検査 5（SG-05）：**装飾の材質と「collider を持たないこと」が同値**であること。
  //
  // 装飾の定義は「`collider` を持たない要素」の 1 つだけ（上位計画 §3 の決定 2）。
  // 同値を課すことで、2 つの壊れかたが 1 つの検査で落ちる。
  //   - 装飾に当たり判定が生えた（パズルの成立条件に触れてしまう）
  //   - 当たり判定を持つものに装飾の材質が付いた（通り抜けられそうに見える）
  const decorIssues: ValidationIssue[] = [];
  for (const entity of level.entities) {
    const decoration = materialFor(entity.type, entity.id).decoration;
    const solid = entity.collider !== undefined;
    if (decoration && solid) {
      decorIssues.push({
        path: `entities.${entity.id}`,
        message: `装飾の材質（${entity.type}）だが collider を持つ。装飾は当たり判定を持たない（SG-05）`,
      });
    } else if (!decoration && !solid) {
      decorIssues.push({
        path: `entities.${entity.id}`,
        message: `collider を持たないが、材質（${entity.type}）が装飾ではない。material.ts で decoration を立てること（SG-05）`,
      });
    }
  }
  if (decorIssues.length > 0) {
    failed = true;
    report(file, decorIssues);
    continue;
  }

  console.log(
    `  ✓ ${file}  セクタ ${level.sectors.length} / 要素 ${level.entities.length} / ` +
      `パズル ${level.puzzles.length} / チェックポイント ${level.checkpoints.length}`,
  );
}

console.log(
  `${failed ? '✗' : '✓'} レベル検査: ${files.length} 件` +
    `（グリッド ${FC_GRID_WORLD} 単位 / 登録パズル ${puzzles.length} 件）`,
);
process.exit(failed ? 1 : 0);
