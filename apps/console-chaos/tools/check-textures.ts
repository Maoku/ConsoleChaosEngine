/**
 * テクスチャ検査（PHASE1_FEEDBACK_PLAN §9.3、T1-21。KV-03 で 4 セットへ広げた）。
 *
 * 画像は「再生成して差分ゼロ」では担保しない（§9.4）。担保するのは**制約のほう**で、
 * ここが §9.1 / §9.2 の指定を機械的に見る。`npm run check:assets` から呼ばれる。
 *
 * 落ちたときの対応は §9.3 の表（変換・リテイク・記録の追加）に従う。
 *
 * KV-03 で足した検査（GRAPHICS_KEY_VISUAL_PLAN §5）:
 *   - 4 セットが**同じ一覧**を持つ（セットの差し替えで穴が空いていない）
 *   - セットの名前が `profiles.ts` の `art.textureSet` と一致する
 *   - 第1世代のセットの色が、`key_palette.ts` の宣言どおりの番号へ落ちる
 *   - F-1 のツタ 2 本が、固定パレットのセットでは潰れ、それ以外では読み分けられる
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { analyzeImage, decodePng, type RgbaImage } from '@console-chaos/asset-pipeline';
import {
  ADJACENT_PAIRS,
  MAX_COLORS,
  MIN_LUMA_DELTA,
  QUANTIZE_LEVELS,
  TEXTURE_SETS,
  TEXTURE_SPECS,
  VINE_PAIR,
  type TextureSet,
  type TextureSpec,
} from './texture_spec';
import { GENERATION_IDS, MASTER_PALETTE_RGB, nearestMasterIndex } from '@console-chaos/engine';
import { FC_PALETTE } from '../src/render/key_palette';
import { CONSOLE_CHAOS_GENERATION_THEMES } from '../src/config/generation';
import { MATERIALS } from '../src/render/material';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEXTURE_DIR = join(ROOT, 'public/assets/textures');
const RECORD = join(ROOT, 'Docs/measurements/T1-21_material.md');

/** 軸に沿った直線構造の下限（隣り合う行または列が完全に一致する割合） */
const MIN_STRAIGHT_RATIO = 0.3;
/** 平坦さ（ノイズでないこと）の下限：横方向の同色の連続長の平均 */
const MIN_RUN_LENGTH = 4;
/**
 * F-1 のツタ 2 本を「別の色として読める」と認める色の隔たり（固定パレットでないセット）。
 *
 * **明度差では測らない。** F-1 の前提は「第1世代は 2 本を区別できないが、
 * それ以外は区別できる」であり、区別の手掛かりは主に色相のほうにある
 *（葉の面積が蔓より小さいので、明度の平均差は小さく出る）。
 */
const MIN_VINE_DISTANCE = 12;

export type Rgb = [number, number, number];

export function luma(rgb: Rgb): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

/** 色相（度）。無彩色は NaN */
export function hueDegrees(rgb: Rgb): number {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return NaN;
  const hue = max === r ? (((g - b) / d) % 6) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (((hue * 60) % 360) + 360) % 360;
}

/**
 * 中間灰（無彩色で、**黒とも白とも呼べない**明るさ）。
 * T1-08 §4 の「灰色に落ちて形が消える」状態。
 *
 * KV-03 で上限 200 を足した。基準画は白を差し色として使う（§1.2）ので、
 * 「白へ落ちる」を形が消えたと数えると、光や雲がどのセットにも置けなくなる。
 * 中間色とは文字どおり黒と白の**間**の無彩色を指す。
 */
function isMidGray(rgb: Rgb): boolean {
  const level = luma(rgb);
  return Math.max(...rgb) - Math.min(...rgb) < 26 && level >= 40 && level <= 200;
}

/**
 * 第1世代の量子化を明度違いで通したとき、色の系統が保たれるか（§9.3）。
 *
 * 落第の条件は 2 つ:
 *   1. どれかの明度で**中間灰**へ落ちる（T1-08 §4。淡い色は必ずこうなる）
 *   2. 有彩色として残ったものどうしの**色相が 45° を超えて動く**
 * 暗く沈んで黒に近づくのは系統の変化ではないので数えない。
 */
export function familyIssue(rgb: Rgb): string | null {
  const quantized = QUANTIZE_LEVELS.map((level) => quantizeFc(rgb, level));
  const shown = QUANTIZE_LEVELS.map((level, i) => `${level}→rgb(${quantized[i]!.join(',')})`).join(' / ');
  if (quantized.some(isMidGray)) return `明度によって中間灰へ落ちる（${shown}）`;
  const hues = quantized.filter((color) => !Number.isNaN(hueDegrees(color)) && luma(color) >= 40).map(hueDegrees);
  let spread = 0;
  for (const a of hues) {
    for (const b of hues) {
      const delta = Math.abs(a - b);
      spread = Math.max(spread, Math.min(delta, 360 - delta));
    }
  }
  return spread > 45 ? `色相が ${spread.toFixed(0)}° 動く（${shown}）` : null;
}

/** 第1世代の量子化（マスターパレットの最近傍）。明度を掛けてから通す */
export function quantizeFc(rgb: Rgb, level = 1): Rgb {
  const index = nearestMasterIndex(rgb[0] * level, rgb[1] * level, rgb[2] * level);
  return [...MASTER_PALETTE_RGB[index]!] as Rgb;
}

function pixel(image: RgbaImage, x: number, y: number): [number, number, number, number] {
  const i = (y * image.width + x) * 4;
  return [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!, image.data[i + 3]!];
}

/** 見えている画素の色（透明な画素は数えない） */
function visibleColors(image: RgbaImage): Map<string, { rgb: Rgb; count: number }> {
  const colors = new Map<string, { rgb: Rgb; count: number }>();
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const [r, g, b, a] = pixel(image, x, y);
      if (a === 0) continue;
      const key = `${r},${g},${b}`;
      const entry = colors.get(key);
      if (entry) entry.count++;
      else colors.set(key, { rgb: [r, g, b], count: 1 });
    }
  }
  return colors;
}

/**
 * 見えている画素の平均明度。
 * 固定パレットのセットは**量子化を通したあと**で測る（画面に出る色で比べるため）。
 */
export function meanLuma(image: RgbaImage, quantized: boolean, level = 1): number {
  let sum = 0;
  let count = 0;
  for (const { rgb, count: n } of visibleColors(image).values()) {
    sum += luma(quantized ? quantizeFc(rgb, level) : rgb) * n;
    count += n;
  }
  return count === 0 ? 0 : sum / count;
}

/** 見えている画素の平均色。2 つの絵を「別の色か」で比べるために使う */
function meanColor(image: RgbaImage): Rgb {
  const sum: [number, number, number] = [0, 0, 0];
  let count = 0;
  for (const { rgb, count: n } of visibleColors(image).values()) {
    for (let c = 0; c < 3; c++) sum[c] = sum[c]! + rgb[c]! * n;
    count += n;
  }
  return count === 0 ? [0, 0, 0] : (sum.map((v) => v / count) as Rgb);
}

/** 端が巻き戻したときに繋がるか。周期的な絵なら、内側の隣接差の最大を超えない */
function seamDelta(image: RgbaImage): { wrapX: number; wrapY: number; interior: number } {
  const columnDiff = (a: number, b: number): number => {
    let sum = 0;
    for (let y = 0; y < image.height; y++) {
      const p = pixel(image, a, y);
      const q = pixel(image, b, y);
      for (let c = 0; c < 4; c++) sum += Math.abs(p[c]! - q[c]!);
    }
    return sum / (image.height * 4);
  };
  const rowDiff = (a: number, b: number): number => {
    let sum = 0;
    for (let x = 0; x < image.width; x++) {
      const p = pixel(image, x, a);
      const q = pixel(image, x, b);
      for (let c = 0; c < 4; c++) sum += Math.abs(p[c]! - q[c]!);
    }
    return sum / (image.width * 4);
  };
  let interior = 0;
  for (let x = 1; x < image.width; x++) interior = Math.max(interior, columnDiff(x - 1, x));
  for (let y = 1; y < image.height; y++) interior = Math.max(interior, rowDiff(y - 1, y));
  return { wrapX: columnDiff(image.width - 1, 0), wrapY: rowDiff(image.height - 1, 0), interior };
}

/** 隣り合う行（列）が完全に一致する割合。軸に沿った直線構造の目安 */
function straightRatio(image: RgbaImage): number {
  const sameRow = (a: number, b: number): boolean => {
    for (let x = 0; x < image.width; x++) {
      const p = pixel(image, x, a);
      const q = pixel(image, x, b);
      for (let c = 0; c < 4; c++) if (p[c] !== q[c]) return false;
    }
    return true;
  };
  const sameColumn = (a: number, b: number): boolean => {
    for (let y = 0; y < image.height; y++) {
      const p = pixel(image, a, y);
      const q = pixel(image, b, y);
      for (let c = 0; c < 4; c++) if (p[c] !== q[c]) return false;
    }
    return true;
  };
  let rows = 0;
  for (let y = 1; y < image.height; y++) if (sameRow(y - 1, y)) rows++;
  let columns = 0;
  for (let x = 1; x < image.width; x++) if (sameColumn(x - 1, x)) columns++;
  return Math.max(rows / (image.height - 1), columns / (image.width - 1));
}

/** 横方向の同色の連続長の平均。小さいとノイズやディザになっている */
function meanRunLength(image: RgbaImage): number {
  let runs = 0;
  for (let y = 0; y < image.height; y++) {
    runs++;
    for (let x = 1; x < image.width; x++) {
      const p = pixel(image, x - 1, y);
      const q = pixel(image, x, y);
      if (p.some((value, c) => value !== q[c])) runs++;
    }
  }
  return (image.width * image.height) / runs;
}

const errors: string[] = [];
/** `<セット>/<ファイル名>` → 画像 */
const images = new Map<string, RgbaImage>();

/** 第1世代のセットで使ってよい色（KV-01 の宣言） */
const FC_INDEX = new Map(FC_PALETTE.map((color) => [color.index, color]));

function check(set: TextureSet, spec: TextureSpec): void {
  const key = `${set.dir}/${spec.file}`;
  const file = join(TEXTURE_DIR, set.dir, spec.file);
  if (!existsSync(file)) {
    errors.push(`${key}: 存在しない（§9.2 の発注表にある）`);
    return;
  }
  if (!/^[a-z0-9_]+\.png$/.test(basename(file))) {
    errors.push(`${key}: ファイル名は小文字スネークケースの .png にする（§9.3）`);
  }

  let image: RgbaImage;
  try {
    image = decodePng(readFileSync(file));
  } catch (e) {
    errors.push(`${key}: PNG として読めない（${(e as Error).message}）`);
    return;
  }
  images.set(key, image);

  const isPowerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;
  if (!isPowerOfTwo(image.width) || !isPowerOfTwo(image.height)) {
    errors.push(`${key}: 寸法 ${image.width}×${image.height} が 2 の冪ではない（§9.1）`);
  }
  if (image.width > 256 || image.height > 256) {
    errors.push(`${key}: 寸法 ${image.width}×${image.height} が上限 256 を超えている（asset-rules.md §7）`);
  }
  if (image.width !== spec.width || image.height !== spec.height) {
    errors.push(`${key}: 発注仕様 ${spec.width}×${spec.height} と実物 ${image.width}×${image.height} が違う`);
  }

  // --- 透過 ---
  const analysis = analyzeImage(image);
  const hasTransparency = analysis.alphaMode !== 'opaque';
  if (spec.alpha && !hasTransparency) errors.push(`${key}: 透過を持つ指定だが、透明な画素が無い`);
  if (!spec.alpha && hasTransparency) errors.push(`${key}: 透過なしの指定だが、透明な画素がある`);

  // --- 色数と淡色の禁止（§9.1） ---
  const colors = [...visibleColors(image).values()];
  const maxColors = spec.maxColors ?? MAX_COLORS;
  if (analysis.visibleColorCount > maxColors) {
    errors.push(`${key}: 色数 ${analysis.visibleColorCount} が上限 ${maxColors} を超えている（§9.1）`);
  }
  for (const { rgb } of colors) {
    const saturation = Math.max(...rgb) - Math.min(...rgb);
    // 上限 200 は isMidGray と同じ理由（白は「中間色」ではない。KV-03）
    if (saturation < 40 && luma(rgb) > 150 && luma(rgb) <= 200) {
      errors.push(`${key}: 淡い色 rgb(${rgb.join(',')}) を使っている（§9.1「低彩度・高明度の中間色は禁止」）`);
    }
  }

  // --- 第1世代のセットだけに掛かる検査（KV-03） ---
  if (set.fixedPalette) {
    for (const { rgb } of colors) {
      // 1. 宣言した 7 色のどれかへ落ちること。「意図しない色に落ちる」を機械で見る
      const index = nearestMasterIndex(rgb[0], rgb[1], rgb[2]);
      const declared = FC_INDEX.get(index);
      if (!declared) {
        errors.push(
          `${key}: rgb(${rgb.join(',')}) が固定 54 色の ${index} 番 [${MASTER_PALETTE_RGB[index]!.join(',')}] へ落ちる。` +
            'key_palette.ts の FC_PALETTE に無い色（KV-01）',
        );
        continue;
      }
      // 2. 陰影を受ける絵に、背景専用の色（白）を置いていないこと
      if (!declared.lit && !spec.unlit) {
        errors.push(
          `${key}: rgb(${rgb.join(',')}) は背景専用の色（${declared.key}）。陰影を受ける絵には置けない（KV-01 §2）`,
        );
      }
      // 3. 陰影の 5 段で色の系統が変わらないこと（§9.3）。
      //    背景は陰影を持たないので、この検査は掛からない
      if (spec.unlit) continue;
      const issue = familyIssue(rgb);
      if (issue) {
        errors.push(`${key}: rgb(${rgb.join(',')}) の${issue}。§9.1「淡い色を使わない」に反する`);
      }
    }
  }

  // --- 平坦さと直線構造（§9.1「ノイズだけの絵では何も起きない」） ---
  if (meanRunLength(image) < MIN_RUN_LENGTH) {
    errors.push(`${key}: 同色の連続が短すぎる（平均 ${meanRunLength(image).toFixed(1)} 画素）。平坦に塗ること`);
  }
  // 直線構造は**敷き詰める絵**にだけ課す。アフィン歪みが読めるのは
  // 床・壁のように大きく引き伸ばされる面であり（§2.4）、小さなプロップの絵ではない
  if (spec.seamless && straightRatio(image) < MIN_STRAIGHT_RATIO) {
    errors.push(
      `${key}: 軸に沿った直線構造が足りない（${(straightRatio(image) * 100).toFixed(0)}% < ${
        MIN_STRAIGHT_RATIO * 100
      }%）。第3世代のアフィン歪みが見えない`,
    );
  }

  // --- 継ぎ目（§9.2 の「継ぎ目」列。背景の層は左右だけ・滝は上下だけ） ---
  if (spec.seamless || spec.seamlessX || spec.seamlessY) {
    const { wrapX, wrapY, interior } = seamDelta(image);
    if ((spec.seamless || spec.seamlessX) && wrapX > interior) {
      errors.push(`${key}: 左右の端が繋がらない（差 ${wrapX.toFixed(1)} > 内側の最大 ${interior.toFixed(1)}）`);
    }
    if ((spec.seamless || spec.seamlessY) && wrapY > interior) {
      errors.push(`${key}: 上下の端が繋がらない（差 ${wrapY.toFixed(1)} > 内側の最大 ${interior.toFixed(1)}）`);
    }
  }
}

for (const set of TEXTURE_SETS) {
  for (const spec of TEXTURE_SPECS) check(set, spec);
}

// --- セットの構成（KV-03） ---
if (existsSync(TEXTURE_DIR)) {
  const known = new Set(TEXTURE_SPECS.map((spec) => spec.file));
  const declaredSets = new Set(TEXTURE_SETS.map((set) => set.dir));
  for (const entry of readdirSync(TEXTURE_DIR)) {
    const path = join(TEXTURE_DIR, entry);
    if (statSync(path).isDirectory()) {
      if (!declaredSets.has(entry)) {
        errors.push(`textures/${entry}/: TEXTURE_SETS に無いセット。表に足すか消すこと`);
        continue;
      }
      for (const file of readdirSync(path)) {
        if (file.endsWith('.png') && !known.has(file)) {
          errors.push(`${entry}/${file}: §9.2 の発注表に無い。表に足すか消すこと`);
        }
      }
      continue;
    }
    if (entry.endsWith('.png')) {
      errors.push(`textures/${entry}: セットの外に PNG がある。KV-03 以降、絵は必ずセットの中に置く`);
    }
  }
}

// セットの名前が世代プロファイルの宣言と一致すること
{
  const declared = TEXTURE_SETS.map((set) => set.dir).join(',');
  const used = GENERATION_IDS.map((id) => CONSOLE_CHAOS_GENERATION_THEMES[id].art.textureSet).join(',');
  if (declared !== used) {
    errors.push(`セットの一覧が食い違う: texture_spec.ts=[${declared}] / profiles.ts=[${used}]`);
  }
}

// --- 隣り合う要素の明度差（§9.3） ---
for (const set of TEXTURE_SETS) {
  for (const [a, b] of ADJACENT_PAIRS) {
    const imageA = images.get(`${set.dir}/${a}`);
    const imageB = images.get(`${set.dir}/${b}`);
    if (!imageA || !imageB) continue;
    const delta = Math.abs(meanLuma(imageA, set.fixedPalette) - meanLuma(imageB, set.fixedPalette));
    if (delta < MIN_LUMA_DELTA) {
      errors.push(
        `${set.dir}: ${a} と ${b} の明度差 ${delta.toFixed(1)} が下限 ${MIN_LUMA_DELTA} を下回る（§9.1「隣り合う要素は明度で分ける」）`,
      );
    }
  }
}

// --- F-1 の組（§9.2 の #5 / #6） ---
const [vineA, vineB] = VINE_PAIR;
for (const set of TEXTURE_SETS) {
  const first = images.get(`${set.dir}/${vineA}`);
  const second = images.get(`${set.dir}/${vineB}`);
  if (!first || !second) continue;
  if (first.width !== second.width || first.height !== second.height) {
    errors.push(`${set.dir}: ${vineA} と ${vineB} の寸法が違う。形状が完全に一致していることが要件`);
    continue;
  }
  // 形（透過の輪郭）が一致すること
  for (let i = 3; i < first.data.length; i += 4) {
    if ((first.data[i]! > 0) !== (second.data[i]! > 0)) {
      errors.push(`${set.dir}: ${vineA} と ${vineB} の形状（透過の輪郭）が一致しない。1 枚を色替えしたものにすること`);
      break;
    }
  }
  if (set.fixedPalette) {
    // 固定パレットのセットでは、どの明度でも同じ色へ潰れること（F-1 の前提）
    for (const level of QUANTIZE_LEVELS) {
      const left = meanLuma(first, true, level);
      const right = meanLuma(second, true, level);
      if (Math.abs(left - right) > 0.5) {
        errors.push(
          `${set.dir}: ${vineA} と ${vineB} が明度 ${level} で潰れきらない（${left.toFixed(1)} / ${right.toFixed(1)}）。F-1 が成立しない`,
        );
      }
    }
  } else {
    // それ以外のセットでは、逆に**別の色として読める**こと（F-1 が解けない側の前提）
    const left = meanColor(first);
    const right = meanColor(second);
    const distance = Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
    if (distance < MIN_VINE_DISTANCE) {
      errors.push(
        `${set.dir}: ${vineA} と ${vineB} の色の隔たり ${distance.toFixed(1)} が小さすぎる（下限 ${MIN_VINE_DISTANCE}）。2 本を読み分けられない`,
      );
    }
  }
}

// --- 天面テクスチャ（SG-04） ---
//
// 天面の絵が 1 セットでも欠けると、その世代だけ足場の上面が
// **直前に誰かがユニット 1 へ束ねた絵**になる（GL のサンプラは既定でユニット 0 を指す）。
// `material.ts` の側は世代を知らないので、揃っているかを見られるのはここだけ。
for (const material of Object.values(MATERIALS)) {
  if (!material.topTexture) continue;
  if (!TEXTURE_SPECS.some((spec) => spec.file === material.topTexture)) {
    errors.push(`天面 ${material.topTexture} が §9.2 の発注表に無い（material.ts が要求している）`);
    continue;
  }
  for (const set of TEXTURE_SETS) {
    if (!images.has(`${set.dir}/${material.topTexture}`)) {
      errors.push(`${set.dir}/${material.topTexture}: 天面テクスチャが揃っていない（SG-04）`);
    }
  }
}

// --- 発注仕様が記録に残っているか（§9.3 の最後の行） ---
if (!existsSync(RECORD)) {
  errors.push('Docs/measurements/T1-21_material.md が無い（発注仕様の記録は §9.4 の再現性の代わり）');
} else {
  const record = readFileSync(RECORD, 'utf8');
  for (const spec of TEXTURE_SPECS) {
    if (!record.includes(spec.file)) errors.push(`T1-21_material.md に ${spec.file} の記載が無い（§9.3）`);
  }
}

console.log('テクスチャ検査（PHASE1_FEEDBACK_PLAN §9.3 / GRAPHICS_KEY_VISUAL_PLAN KV-03）');
for (const set of TEXTURE_SETS) {
  console.log(`  [${set.dir}]${set.fixedPalette ? ' 固定 54 色' : ''}`);
  for (const spec of TEXTURE_SPECS) {
    const image = images.get(`${set.dir}/${spec.file}`);
    if (!image) continue;
    const colors = visibleColors(image).size;
    console.log(
      `    ${spec.file.padEnd(18)} ${String(image.width).padStart(3)}×${String(image.height).padEnd(3)}` +
        ` 色 ${String(colors).padStart(2)}  明度 ${meanLuma(image, set.fixedPalette).toFixed(0).padStart(3)}` +
        `  直線 ${(straightRatio(image) * 100).toFixed(0).padStart(3)}%${spec.seamless ? '  継ぎ目要' : ''}`,
    );
  }
}

if (errors.length > 0) {
  console.error('\n✗ テクスチャ検査に失敗');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log('✓ すべてのテクスチャが §9.1 / §9.2 / §9.3 と KV-03 の制約に収まっている');
