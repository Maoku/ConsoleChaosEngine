/**
 * 行数バジェット検査（IMPLEMENTATION_PLAN §5.3.3）。
 *
 * `src/render/gl/` は合計 1,500 行を上限とし、ファイル別にも上限を配分する。
 * 超過時の対応は「バジェットを上げる」ではなく「ゲーム側の要求を削る」を第一候補とする。
 * バジェットの変更は IMPLEMENTATION_PLAN の改訂を伴う。
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** ファイル別の上限（§5.3.3、および §4.3 の ECS 上限） */
const FILE_BUDGETS: Record<string, number> = {
  'src/render/gl/context.ts': 150,
  'src/render/gl/shader.ts': 250,
  'src/render/gl/buffer.ts': 250,
  'src/render/gl/texture.ts': 250,
  'src/render/gl/framebuffer.ts': 200,
  'src/render/gl/state.ts': 250,
  'src/render/gl/index.ts': 100,
};

/** ECS は合計 400 行を上限とする（§4.3）。凝った最適化はしない方針の担保 */
const ECS_FILES = [
  'src/core/ecs/world.ts',
  'src/core/ecs/component.ts',
  'src/core/ecs/query.ts',
  'src/core/ecs/system.ts',
];
const ECS_BUDGET = 400;

/** ディレクトリ合計の上限（§5.3.3） */
const TOTAL_BUDGET = 1500;

/** 空行とコメント行を除いた実効行数を数える */
function countEffectiveLines(source: string): number {
  let inBlockComment = false;
  let count = 0;
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line === '') continue;
    if (line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    count++;
  }
  return count;
}

let total = 0;
let failed = false;
const rows: Array<[string, number, number]> = [];

for (const [rel, budget] of Object.entries(FILE_BUDGETS)) {
  const abs = join(ROOT, rel);
  const lines = existsSync(abs) ? countEffectiveLines(readFileSync(abs, 'utf8')) : 0;
  total += lines;
  rows.push([rel, lines, budget]);
  if (lines > budget) {
    failed = true;
    console.error(`✗ ${relative(ROOT, abs)}: ${lines} 行 > 上限 ${budget} 行`);
  }
}

const width = Math.max(...rows.map(([rel]) => rel.length));
console.log('行数バジェット（空行・コメント行を除く）');
for (const [rel, lines, budget] of rows) {
  const mark = lines > budget ? '✗' : '✓';
  console.log(`  ${mark} ${rel.padEnd(width)}  ${String(lines).padStart(4)} / ${budget}`);
}
console.log(`  ${total > TOTAL_BUDGET ? '✗' : '✓'} ${'合計'.padEnd(width)}  ${String(total).padStart(4)} / ${TOTAL_BUDGET}`);

if (total > TOTAL_BUDGET) {
  failed = true;
  console.error(`✗ src/render/gl/ の合計 ${total} 行が上限 ${TOTAL_BUDGET} 行を超えている`);
}

// --- ECS（§4.3） ---
let ecsTotal = 0;
console.log('\nECS の行数バジェット（§4.3）');
for (const rel of ECS_FILES) {
  const abs = join(ROOT, rel);
  const lines = existsSync(abs) ? countEffectiveLines(readFileSync(abs, 'utf8')) : 0;
  ecsTotal += lines;
  console.log(`    ${rel.padEnd(width)}  ${String(lines).padStart(4)}`);
}
console.log(`  ${ecsTotal > ECS_BUDGET ? '✗' : '✓'} ${'合計'.padEnd(width)}  ${String(ecsTotal).padStart(4)} / ${ECS_BUDGET}`);
if (ecsTotal > ECS_BUDGET) {
  failed = true;
  console.error(`✗ ECS の合計 ${ecsTotal} 行が上限 ${ECS_BUDGET} 行を超えている（§4.3）`);
}

if (failed) {
  console.error('\n行数バジェット超過。まず「ゲーム側の要求を削れないか」を検討すること（§5.3.3）。');
  process.exit(1);
}
