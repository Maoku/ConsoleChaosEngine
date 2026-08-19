/**
 * 外部素材の取り込み（SG-01。`Docs/development/GRAPHICS_STAGE_IMPL_PLAN.md` §3 の SG-01）。
 *
 * `Docs/concept/source/src_*.png`（発注仕様 `ASSET_REQUEST_STAGE.md` の納品物）を読み、
 * **4 セットぶんの絵**を `public/assets/textures/<セット>/` へ書き出す。
 *
 * `make-textures.ts` との分担（実装計画 §2 の判断 A）:
 *   - 原画のある 13 枚 … ここ
 *   - 原画の無い 4 枚（`metal_grate` / `shell_plate` / `mark_glyph` / `pedestal_top`） … `make-textures.ts`
 *
 * **手続きは 3 段しか無い。**
 *   1. 縮小（ブロック内の最頻色。判断 B）
 *   2. セットごとの変換（判断 C）
 *   3. 書き出し
 * 汎用の画像処理系は作らない（§11.1.1）。ここにあるのは 4 セットを出すのに要る式だけである。
 *
 * 実行:
 *   npm run import:textures
 * 検査:
 *   npm run check:assets
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  decodePng,
  flipVertical,
  luma,
  mapRgb,
  rgb555HighBits,
  shrinkByMode,
  writePngIfChanged,
  type Rgb,
  type RgbaImage,
} from '@console-chaos/asset-pipeline';
import { TEXTURE_SETS, TEXTURE_SPECS, type TextureSpec } from './texture_spec';
import { heartRects } from './glyph_heart';
import { FC_PALETTE, type KeyColorName } from '../src/render/key_palette';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'Docs/concept/source');
const OUT_DIR = join(ROOT, 'public/assets/textures');

/**
 * 取り込む 1 枚。
 *
 * `fc` は**その絵が第1世代で使ってよい色**（判断 D の 7 色の名前）。
 * 色ごとではなく**絵ごとの役割**で宣言するのが要点で、最近傍では第1世代が作れない（W-4）。
 */
interface ImportSpec {
  /** `TEXTURE_SPECS` にあるファイル名。寸法はそちらが正本 */
  file: string;
  /** `Docs/concept/source/` の原画（`src_` を除いた名前） */
  source: string;
  /** 第1世代で使う色。**明度順に並べ替えてから**原画の色へ対応づける */
  fc: readonly KeyColorName[];
  /**
   * 綱として横に架ける絵か（F-1 のツタ）。
   *
   * **箱の UV はワールド寸法から作られる**（`geometry.ts` の `boxMesh`）。
   * 8m × 0.5m の綱に `uvScale: 1` で貼ると、綱の太さの向きには
   * **半周期ぶんしか乗らず、しかも v = 0（＝絵の上下の端）が中心に来る**。
   * 縦に伸びる蔓を描いた絵をそのまま貼ると、綱には上下の端しか出ない。
   * 端は 93% が透明なので、抜きを掛けると綱が千切れた鉤の列になる。
   *
   * そこで取り込みで 2 つ直す。
   *   1. **90° 回して**、蔓が綱の長さの向き（u）に走るようにする
   *   2. **縦に半周期ずらして**、蔓の芯が絵の上下の端（＝綱の中心）へ来るようにする
   * これで綱の中心を芯が通り、葉が長さに沿って並ぶ
   */
  rope?: boolean;
  /**
   * 中心に紋（ハート）を重ねるか（SG-10、判断 J）。
   *
   * 納品された `src_pedestal_top` は同心円で KV-09 のハートを持たないので取り込まない。
   * 代わりに**門の光へハートを 1 つ重ねる**。形は `tools/glyph_heart.ts` が持ち、
   * `make-textures.ts` の台座と同じものを読む（紋の語彙を 2 か所に散らさない）。
   *
   * 色は**原画にあって縮小で消えた色**を使う。新しい色を作らない代わりに、
   * 紋だけが持つ 1 色になるので、輪郭の検査（KV-09）が機械的に効く
   */
  glyph?: boolean;
}

/**
 * 13 枚の取り込み表。
 *
 * 第1世代の色数の上限には根拠がある。
 *   - `grass_top` の 2 色 … 足場は天面と側面で 2 枚のテクスチャを持つ（SG-04）。
 *     16×16 のブロックに収まる 3 色 + 抜きのうち、天面が使えるのは 2 色まで
 *   - `backdrop_far` の 3 色 … 空 1 色 + 遠景 3 色で 4 番号（`backdrop.test.ts` の第1世代の検査）
 */
const IMPORTS: readonly ImportSpec[] = [
  { file: 'grass_top.png', source: 'grass_top', fc: ['grass', 'conifer'] },
  { file: 'stone_floor.png', source: 'stone_floor', fc: ['sand', 'sandstone'] },
  { file: 'stone_wall.png', source: 'stone_wall', fc: ['sandstone', 'conifer'] },
  { file: 'backdrop_far.png', source: 'backdrop_far', fc: ['mesa', 'sandstone', 'conifer'] },
  { file: 'backdrop_near.png', source: 'backdrop_near', fc: ['white', 'skyDay'] },
  { file: 'tree_pine.png', source: 'tree_pine', fc: ['conifer', 'grass'] },
  { file: 'foliage_tuft.png', source: 'foliage_tuft', fc: ['grass', 'conifer'] },
  { file: 'cloud_bank.png', source: 'cloud_bank', fc: ['white', 'skyDay'] },
  { file: 'water_fall.png', source: 'water_fall', fc: ['white', 'skyDay'] },
  { file: 'gate_glow.png', source: 'gate_glow', fc: ['sandstone', 'conifer', 'skyDay', 'mesa', 'white'], glyph: true },
  // F-1 の 2 本は**同じ 2 色**へ落とす。第1世代で区別できないことが F-1 の前提
  { file: 'vine_green.png', source: 'vine_green', fc: ['conifer', 'grass'], rope: true },
  { file: 'vine_yellow.png', source: 'vine_yellow', fc: ['conifer', 'grass'], rope: true },
  { file: 'enemy_body.png', source: 'enemy_body', fc: ['mesa', 'sandstone', 'sand'] },
];

/**
 * 中心に紋（ハート）を重ねる（SG-10）。
 *
 * **色は原画にあって縮小で消えた色から採る。** 新しい色を作らずに済み、
 * かつ紋だけが持つ 1 色になるので、KV-09 の輪郭の検査が機械的に効く。
 * 縮小後の絵に無く、原画にある色のうち、いちばん面積の大きいものを選ぶ。
 */
function stampGlyph(shrunk: RgbaImage, original: RgbaImage): RgbaImage {
  const present = new Set(visibleColorsByLuma(shrunk).map((rgb) => rgb.join(',')));
  const counts = new Map<string, { rgb: [number, number, number]; count: number }>();
  for (let i = 0; i < original.data.length; i += 4) {
    if (original.data[i + 3] === 0) continue;
    const rgb: [number, number, number] = [original.data[i]!, original.data[i + 1]!, original.data[i + 2]!];
    const key = rgb.join(',');
    if (present.has(key)) continue;
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { rgb, count: 1 });
  }
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count || luma(...b.rgb) - luma(...a.rgb));
  const glyph = ranked[0];
  if (!glyph) throw new Error('紋に使える色が原画に残っていない（縮小で色が減らなかった）');

  const data = new Uint8Array(shrunk.data);
  const scale = (shrunk.width / 64) * 0.78;
  const inset = Math.round((shrunk.width - 64 * scale) / 2);
  for (const [x0, y0, x1, y1] of heartRects(scale, inset)) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= shrunk.width || y >= shrunk.height) continue;
        const i = (y * shrunk.width + x) * 4;
        data.set(glyph.rgb, i);
        data[i + 3] = 255;
      }
    }
  }
  return { width: shrunk.width, height: shrunk.height, data };
}

/**
 * 綱に貼れる向きへ直す（F-1）。90° 回してから、縦に半分ずらす。
 *
 * 回すのは蔓を綱の長さへ寝かせるため、ずらすのは芯を綱の中心へ持ってくるためである
 *（箱の UV は面の中心が v = 0 なので、ずらさないと芯が綱の上下の縁に出る）。
 */
function layAlongRope(image: RgbaImage): RgbaImage {
  const width = image.height;
  const height = image.width;
  const data = new Uint8Array(image.data.length);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      // 90° 回転（元の (x, y) が新しい (y, x) へ）と、縦の半周期ずらしを 1 度に行う
      const rx = y;
      const ry = (x + Math.floor(height / 2)) % height;
      const from = (y * image.width + x) * 4;
      const to = (ry * width + rx) * 4;
      data.set(image.data.subarray(from, from + 4), to);
    }
  }
  return { width, height, data };
}

/** 見えている画素の色（透明は数えない）。明度の低い順 */
function visibleColorsByLuma(image: RgbaImage): Array<[number, number, number]> {
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] === 0) continue;
    const rgb: [number, number, number] = [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!];
    seen.set(rgb.join(','), rgb);
  }
  return [...seen.values()].sort((a, b) => luma(...a) - luma(...b));
}

const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

// --- セットごとの変換（判断 C） -------------------------------------------

/** 第2世代：彩度を 1.18 倍し、各チャンネルを RGB555 へ丸める */
function toGen2(rgb: Rgb): Rgb {
  const y = luma(...rgb);
  return [
    rgb555HighBits(y + (rgb[0] - y) * 1.18),
    rgb555HighBits(y + (rgb[1] - y) * 1.18),
    rgb555HighBits(y + (rgb[2] - y) * 1.18),
  ];
}

/**
 * 第3世代：同明度の灰青と 6:4 で混ぜ、全体を 0.82 倍する。
 *
 * **禁止域（彩度 40 未満・明度 150〜200）へ入ったら明度を上げて抜ける。**
 * 下へ抜けると `stone_floor` が `grass_top` との明度差 20 を割る（実装計画 §2 の判断 C）。
 * 禁止域は「黒と白の間の無彩色」であって、白そのものは禁止ではない。
 */
const GEN3_ESCAPE_LUMA = 208;

function toGen3(rgb: Rgb): Rgb {
  const y = luma(...rgb);
  const grayBlue = [y * 0.92, y * 0.97, y * 1.12];
  let mixed = rgb.map((c, i) => clamp((c * 0.6 + grayBlue[i]! * 0.4) * 0.82)) as [number, number, number];
  const saturation = Math.max(...mixed) - Math.min(...mixed);
  const level = luma(...mixed);
  if (saturation < 40 && level > 150 && level <= 200) {
    mixed = mixed.map((c) => clamp((c * GEN3_ESCAPE_LUMA) / level)) as [number, number, number];
  }
  return mixed;
}

/**
 * 第1世代：判断 D の宣言写像（W-4）。
 *
 * **最近傍では作れない。** 原画の主要な色は固定 54 色の 14 個の番号へ散り、
 * うち 7 色が中間灰へ落ちて形が消える。したがって
 * 「原画の色を明度順に並べ、その絵に割り当てられた色へ明度順に対応づける」。
 * 表に無い色が来たらその場で落とす（黙って最近傍へ逃がさない）。
 */
function gen1Map(image: RgbaImage, keys: readonly KeyColorName[]): Map<string, [number, number, number]> {
  const targets = keys
    .map((key) => {
      const found = FC_PALETTE.find((color) => color.key === key);
      if (!found) throw new Error(`${key} は FC_PALETTE に無い（key_palette.ts）`);
      return found;
    })
    .sort((a, b) => luma(...(a.source as unknown as [number, number, number])) - luma(...(b.source as unknown as [number, number, number])));
  const sources = visibleColorsByLuma(image);
  const map = new Map<string, [number, number, number]>();
  sources.forEach((rgb, rank) => {
    const target = targets[Math.min(targets.length - 1, Math.floor((rank * targets.length) / sources.length))]!;
    map.set(rgb.join(','), [...target.source] as [number, number, number]);
  });
  return map;
}

function convert(dir: string, image: RgbaImage, spec: ImportSpec): RgbaImage {
  if (dir === 'gen4') return image;
  if (dir === 'gen2') return mapRgb(image, toGen2);
  if (dir === 'gen3') return mapRgb(image, toGen3);
  if (dir === 'gen1') {
    const map = gen1Map(image, spec.fc);
    return mapRgb(image, (rgb) => {
      const found = map.get(rgb.join(','));
      if (!found) throw new Error(`${spec.file}: rgb(${rgb.join(',')}) が第1世代の写像表に無い`);
      return found;
    });
  }
  throw new Error(`${dir} の変換規則が無い`);
}

// --- 実行 -----------------------------------------------------------------

const specByFile = new Map<string, TextureSpec>(TEXTURE_SPECS.map((spec) => [spec.file, spec]));

for (const set of TEXTURE_SETS) mkdirSync(join(OUT_DIR, set.dir), { recursive: true });

for (const entry of IMPORTS) {
  const spec = specByFile.get(entry.file);
  if (!spec) throw new Error(`${entry.file} が texture_spec.ts の TEXTURE_SPECS に無い`);
  const original = decodePng(readFileSync(join(SOURCE_DIR, `src_${entry.source}.png`)));

  // 綱は縮小のあとに 90° 回すので、突き合わせる寸法も入れ替えておく
  const [specWidth, specHeight] = entry.rope ? [spec.height, spec.width] : [spec.width, spec.height];
  const factor = original.width / specWidth;
  if (original.height / specHeight !== factor) {
    throw new Error(`${entry.file}: 縦横で縮小率が違う（${factor} と ${original.height / specHeight}）`);
  }
  // 紋は**上下を入れ替える前**に重ねる。絵と同じ向きで組んでおけば、
  // 貼ったときも紋だけが逆さまになることが無い
  let shrunk = shrinkByMode(original, factor);
  if (entry.glyph) shrunk = stampGlyph(shrunk, original);
  if (entry.rope) shrunk = layAlongRope(shrunk);
  if (spec.flip) shrunk = flipVertical(shrunk);
  const colors = visibleColorsByLuma(shrunk).length;
  for (const set of TEXTURE_SETS) {
    writePngIfChanged(join(OUT_DIR, set.dir, entry.file), convert(set.dir, shrunk, entry));
  }
  console.log(
    `  ${entry.file.padEnd(18)} ${original.width}×${original.height} → ${spec.width}×${spec.height}` +
      `（1/${factor}）色 ${colors} → 第1世代 ${entry.fc.length} 色`,
  );
}

console.log(`取り込んだ: ${IMPORTS.length} 枚 × ${TEXTURE_SETS.length} セット = ${IMPORTS.length * TEXTURE_SETS.length} 枚`);
