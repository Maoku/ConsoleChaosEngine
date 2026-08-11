/**
 * 実機名・ロゴ由来語の混入チェック（GAME_PLAN §7.1.1 / IMPLEMENTATION_PLAN §7.3）。
 *
 * 検査対象: src/ tools/ tests/ public/ index.html README.md のテキストとファイル名。
 * Docs/ は仕様を論じる文書であり、実機名に言及することが正当なため対象外とする。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SCAN_PATHS = ['src', 'tools', 'tests', 'public', 'index.html', 'README.md'];
/**
 * 中身を読む拡張子。
 * `.gltf` は JSON で、**ノード名・マテリアル名・アニメ名がそのまま入る**。
 * Blender のオブジェクト名が出力に残るため、アセット側の混入経路として一番危ない（T1-19）。
 */
const TEXT_EXT = new Set([
  '.ts', '.js', '.glsl', '.html', '.css', '.json', '.md', '.txt', '.gltf', '.py',
]);

const blocklist = readFileSync(join(ROOT, 'Docs/trademark-blocklist.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'))
  .map((l) => l.toLowerCase());

interface Hit {
  file: string;
  line: number;
  word: string;
  text: string;
}

const hits: Hit[] = [];
/** 走査したファイル数（全走査であることを出力で示すため。T1-19） */
let scanned = 0;
let scannedText = 0;

/** 語境界を持つ検索。3 文字の略号が別の単語の一部に一致しないようにする */
function findWord(haystack: string, needle: string): number {
  const pattern = new RegExp(`(?<![a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`);
  return haystack.search(pattern);
}

function scanFile(abs: string): void {
  const rel = relative(ROOT, abs);
  const lowerName = rel.toLowerCase();
  scanned++;
  for (const word of blocklist) {
    if (findWord(lowerName, word) >= 0) {
      hits.push({ file: rel, line: 0, word, text: '(ファイル名)' });
    }
  }
  if (!TEXT_EXT.has(extname(abs))) return;
  scannedText++;
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((text, i) => {
    const lower = text.toLowerCase();
    for (const word of blocklist) {
      if (findWord(lower, word) >= 0) {
        hits.push({ file: rel, line: i + 1, word, text: text.trim() });
      }
    }
  });
}

function walk(abs: string): void {
  let st;
  try {
    st = statSync(abs);
  } catch {
    return; // まだ存在しないパスは無視する
  }
  if (st.isDirectory()) {
    for (const entry of readdirSync(abs)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      walk(join(abs, entry));
    }
  } else {
    scanFile(abs);
  }
}

for (const p of SCAN_PATHS) walk(join(ROOT, p));

if (hits.length > 0) {
  console.error('✗ 実機名・商標由来語の混入を検出（GAME_PLAN §7.1.1）');
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  "${h.word}"  ${h.text}`);
  }
  console.error('\n本作はエミュレータではない。世代は CH 1〜4 / 第1〜4世代 の表示名で扱うこと。');
  process.exit(1);
}

console.log(`✓ 商標チェック通過（禁止語 ${blocklist.length} 件 / 走査 ${scanned} ファイル、うち中身の検査 ${scannedText} ファイル）`);
console.log('  ※ ロゴ・固有形状（実機やコントローラの見た目）は自動検査できない。目視確認の記録は Docs/measurements/T1-19_trademark_scan.md');
