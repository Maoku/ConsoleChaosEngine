/**
 * テクスチャの生成（T1-21。KV-03 で世代ごとの 4 セットへ分けた）。
 *
 * **SG-01 で 11 手続きから 4 手続きへ縮んだ。** 原画のある 13 枚は
 * `tools/import-textures.ts` が外部素材から出す（実装計画 §2 の判断 A）。
 * ここに残るのは**原画を持たない 4 枚**だけである。
 *   - `metal_grate` / `shell_plate` / `mark_glyph` … 上位計画 §6 のとおり発注しない
 *   - `pedestal_top` … 発注したが、納品物が KV-09 の紋を持たないので取り込まない（判断 J）
 * 「形の手続き 1 つ・色表 4 つ」という KV-03 の形はそのまま残る。
 *
 * PHASE1_FEEDBACK_PLAN §9.2 の発注仕様を、そのまま描画手続きにしたもの。
 *
 * **§9.4 からの変更（判断の記録）**：計画では「生成画像は作り直せないので PNG を正本にする」
 * としていた。実際には画像生成の手を用意できなかったため、
 * §9.1 / §9.2 の制約（平坦・直線・限られた色数・淡色禁止・シームレス）を
 * 満たす絵を**手続きとして書き**、出力を `public/assets/textures/` に置いた。
 * 結果としてモデルと同じく「スクリプトが正本」に戻っており、再現性はむしろ強くなっている
 *（§8.1 の非対称の心配が消える）。公開用の結論は `Docs/VALIDATION.md` にまとめる。
 *
 * **KV-03 の構造（GRAPHICS_KEY_VISUAL_PLAN §3 の決定 3）**：
 * 色は乗算ではなく**セットの差し替え**で出す。したがってこのファイルは
 *   - 形の手続き … 1 つ（`stoneFloor` などの関数）
 *   - 色表 … 4 つ（`SET_COLORS`）
 * という形を保つ。**手続きの中に色のリテラルを書かない。**
 *
 * 実行:
 *   npx tsx tools/make-textures.ts
 * 検査:
 *   npm run check:assets（`check-textures.ts` が §9.3 と KV-03 の制約を機械的に見る）
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writePngIfChanged, type RgbaImage } from '@console-chaos/asset-pipeline';
import { TEXTURE_SETS, TEXTURE_SPECS, type TextureSpec } from './texture_spec';
import { heartRects } from './glyph_heart';
import { fcColorOf } from '../src/render/key_palette';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/assets/textures');

type Rgb = readonly [number, number, number];

// --- 最小の描画ヘルパ（画像ライブラリを足さないため。§1.3） ---

interface Canvas {
  readonly image: RgbaImage;
  set(x: number, y: number, color: Rgb, alpha?: number): void;
  fill(color: Rgb, alpha?: number): void;
  rect(x0: number, y0: number, x1: number, y1: number, color: Rgb, alpha?: number): void;
}

function createCanvas(width: number, height: number): Canvas {
  const data = new Uint8Array(width * height * 4);
  const image: RgbaImage = { width, height, data };
  const set = (x: number, y: number, color: Rgb, alpha = 255): void => {
    // 繰り返し前提の絵は端をはみ出しても巻き戻す（シームレスを手続きで保証する）
    const px = ((x % width) + width) % width;
    const py = ((y % height) + height) % height;
    const i = (py * width + px) * 4;
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = alpha;
  };
  return {
    image,
    set,
    fill(color, alpha = 255): void {
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, color, alpha);
    },
    rect(x0, y0, x1, y1, color, alpha = 255): void {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, color, alpha);
    },
  };
}

// --- 色表 ---------------------------------------------------------------
//
// §9.1 の「淡い色を使わない」「隣り合う要素は明度で分ける」を守る。
// 明度は 0.299R + 0.587G + 0.114B（common.glsl の luma と同じ重み）。
//
// **どの色も彩度を高く取る。** 低彩度の色は明度を掛けると中間灰へ落ちて形が消える
//（T1-08 §4 の実測。`check-textures.ts` が機械的に見る）。

/**
 * 1 セットぶんの色。**形の手続きが見るのはこの名前だけ**で、16 進数は見ない。
 * セットを増やすときはここへ 1 行足せば、9 枚 + 背景 2 枚が同じ形で出る。
 */
interface SetColors {
  /** `public/assets/textures/<dir>/` */
  dir: string;
  /** 仕掛け・装置：床より大きく暗い。穴の内側はさらに暗い */
  device: { plate: Rgb; rim: Rgb; hole: Rgb; rivet: Rgb };
  /** 殻（P1-2）：継ぎ目とリベットで「割れる」ことを予告する */
  shell: { plate: Rgb; seam: Rgb; rivet: Rgb; panel: Rgb };
  /** 目標（台座・核）：**世界でいちばん目を引く色**にする */
  goal: { stone: Rgb; groove: Rgb; rim: Rgb; inner: Rgb };
  /** 紋（刻印）：床と明度で分ける */
  mark: { base: Rgb; line: Rgb; deep: Rgb };
}

/**
 * 第1世代の色は `src/render/key_palette.ts` の 7 色だけから引く。
 * ここに 16 進数を直接書くと、固定 54 色との対応が 2 箇所に散る（KV-01 の趣旨）。
 */
const FC = {
  sky: fcColorOf('skyDay').source,
  grass: fcColorOf('grass').source,
  conifer: fcColorOf('conifer').source,
  sand: fcColorOf('sand').source,
  sandstone: fcColorOf('sandstone').source,
  mesa: fcColorOf('mesa').source,
} as const;

const SET_COLORS: readonly SetColors[] = [
  /**
   * 第1世代：固定 54 色から選んだ空のテーマ（SG-02 の判断 D）。
   * **使えるのは 7 色だけ**で、それが第1世代の姿である。
   * 黒は使わない（基準画 F「どこにも黒が無い」）。いちばん暗い色は砂岩。
   *
   * 割り当ては**明度帯で分ける**（色相では第1世代は分離しない。T1-08 §4）。
   * `goal.stone` に `sand` を置いてはいけない。`stone_floor` の 85% が砂色なので、
   * `stone_floor ↔ pedestal_top` の明度差が下限 20 を割る。
   * `shell_plate ↔ pedestal_top` も同じ理由で別の明度帯へ分ける
   */
  {
    dir: 'gen1',
    device: { plate: FC.sandstone, rim: FC.sky, hole: FC.conifer, rivet: FC.sand },
    shell: { plate: FC.sandstone, seam: FC.conifer, rivet: FC.sand, panel: FC.mesa },
    goal: { stone: FC.mesa, groove: FC.sandstone, rim: FC.sand, inner: FC.sky },
    mark: { base: FC.sandstone, line: FC.sand, deep: FC.conifer },
  },
  /**
   * 第2世代：明るく色数の多い積み木の国（KV-05）。
   * 色数の制限を持たない世代なので、**同時に出す色相をいちばん多く取る**
   */
  {
    dir: 'gen2',
    device: { plate: [0x1c, 0x70, 0xb8], rim: [0x48, 0xa8, 0xe0], hole: [0x08, 0x18, 0x38], rivet: [0x10, 0x40, 0x70] },
    shell: { plate: [0xd8, 0x90, 0x30], seam: [0x60, 0x38, 0x08], rivet: [0xf8, 0xd0, 0x60], panel: [0xb0, 0x70, 0x20] },
    // SG-01 で床が砂色（明度 191）になったので、目標を黄色から朱へ移した。
    // 明度で 20 以上離れないと「床に置かれた台座」として読めない（`check:assets`）
    goal: { stone: [0xe8, 0x38, 0x10], groove: [0x60, 0x10, 0x08], rim: [0xf8, 0xa0, 0x30], inner: [0xb8, 0x20, 0x08] },
    mark: { base: [0x88, 0x28, 0x58], line: [0xf8, 0x70, 0xa8], deep: [0x40, 0x10, 0x30] },
  },
  /**
   * 第3世代：灰の角張った岩（KV-06）。
   * **色が乏しいことが特徴**なので、灰紫の 1 系統で通し、赤は目標の扉にだけ使う
   */
  {
    dir: 'gen3',
    device: { plate: [0x28, 0x40, 0x5c], rim: [0x48, 0x70, 0xa0], hole: [0x0c, 0x12, 0x20], rivet: [0x18, 0x2c, 0x44] },
    shell: { plate: [0x78, 0x68, 0x58], seam: [0x30, 0x28, 0x20], rivet: [0xa8, 0x98, 0x78], panel: [0x60, 0x54, 0x44] },
    goal: { stone: [0xe8, 0x38, 0x48], groove: [0x78, 0x10, 0x20], rim: [0xf8, 0x90, 0x98], inner: [0xc0, 0x28, 0x38] },
    mark: { base: [0x30, 0x28, 0x40], line: [0x78, 0x68, 0x90], deep: [0x18, 0x14, 0x24] },
  },
  /**
   * 第4世代：暗いが窓が光る街（KV-07）。
   * **地の色をいちばん暗く取る。** 見えるのは松明と窓の光があるからで、
   * 第3世代と並べたときの差はそこに出る
   */
  {
    dir: 'gen4',
    device: { plate: [0x50, 0x80, 0xb0], rim: [0x88, 0xb8, 0xe0], hole: [0x10, 0x18, 0x28], rivet: [0x30, 0x54, 0x78] },
    shell: { plate: [0x58, 0x50, 0x40], seam: [0x1c, 0x18, 0x14], rivet: [0x90, 0x84, 0x60], panel: [0x44, 0x3c, 0x30] },
    goal: { stone: [0xf8, 0x58, 0x88], groove: [0x80, 0x18, 0x38], rim: [0xf8, 0xc0, 0xd0], inner: [0xd0, 0x38, 0x68] },
    mark: { base: [0x18, 0x1c, 0x30], line: [0x68, 0x78, 0xa0], deep: [0x0a, 0x0c, 0x18] },
  },
];

// --- 各テクスチャ（形の手続き。**セットごとに変わるのは引数の色だけ**） ---

/** 規則的な四角い穴が等間隔に開き、縁にリベット */
function metalGrate(size: number, c: SetColors): Canvas {
  const canvas = createCanvas(size, size);
  const cell = size / 4;
  canvas.fill(c.device.plate);
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      const x = cx * cell;
      const y = cy * cell;
      canvas.rect(x + 5, y + 5, x + cell - 5, y + cell - 5, c.device.rim);
      canvas.rect(x + 8, y + 8, x + cell - 8, y + cell - 8, c.device.hole);
      // リベットはセルの角に置く（巻き戻しで四隅が繋がる）
      canvas.rect(x - 2, y - 2, x + 2, y + 2, c.device.rivet);
    }
  }
  return canvas;
}

/** 継ぎ目で分割された装甲板。境界線がはっきり通り、境界に沿ってリベットが並ぶ */
function shellPlate(size: number, c: SetColors): Canvas {
  const canvas = createCanvas(size, size);
  const plate = size / 2;
  canvas.fill(c.shell.plate);
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      // 板の内側に、継ぎ目と平行な浅い溝を 1 本入れる（面の向きが分かるように）
      canvas.rect(px * plate + 12, py * plate + plate / 2 - 1, (px + 1) * plate - 12, py * plate + plate / 2 + 1, c.shell.panel);
    }
  }
  // 継ぎ目（縦横の帯）
  for (let i = 0; i < 2; i++) {
    canvas.rect(i * plate - 3, 0, i * plate + 3, size, c.shell.seam);
    canvas.rect(0, i * plate - 3, size, i * plate + 3, c.shell.seam);
  }
  // 継ぎ目に沿ったリベット
  for (let t = 8; t < size; t += 16) {
    for (let i = 0; i < 2; i++) {
      canvas.rect(i * plate - 2, t - 2, i * plate + 2, t + 2, c.shell.rivet);
      canvas.rect(t - 2, i * plate - 2, t + 2, i * plate + 2, c.shell.rivet);
    }
  }
  return canvas;
}

/**
 * 紋を描く（KV-09）。形は `tools/glyph_heart.ts` が持つ（SG-10 で外へ出した）。
 * **同じ形を `import-textures.ts` も読む**ので、台座の紋と門の紋が食い違わない。
 */
function heart(canvas: Canvas, scale: number, color: Rgb, offset = 0): void {
  for (const [x0, y0, x1, y1] of heartRects(scale, offset)) canvas.rect(x0, y0, x1, y1, color);
}

/** 台座の天面。中央に紋（ハート）を彫り、明るい縁取りで「触れる対象」だと示す */
function pedestalTop(size: number, c: SetColors): Canvas {
  const canvas = createCanvas(size, size);
  const scale = (size / 64) * 0.82;
  const inset = Math.round((size - 64 * scale) / 2);
  canvas.fill(c.goal.stone);
  // 縁取り。天面の輪郭が読めないと、乗れる面なのかが分からない
  canvas.rect(0, 0, size, 3, c.goal.inner);
  canvas.rect(0, size - 3, size, size, c.goal.inner);
  canvas.rect(0, 0, 3, size, c.goal.inner);
  canvas.rect(size - 3, 0, size, size, c.goal.inner);
  // 落ち影を 2 画素ずらして置き、平らな塗りのまま厚みを出す
  heart(canvas, scale, c.goal.groove, inset + 2);
  heart(canvas, scale, c.goal.rim, inset);
  return canvas;
}

/** 床に彫られた紋。台座と同じハートで、周囲の床より暗い */
function markGlyph(size: number, c: SetColors): Canvas {
  const canvas = createCanvas(size, size);
  const scale = (size / 64) * 0.78;
  const inset = Math.round((size - 64 * scale) / 2);
  canvas.fill(c.mark.base);
  // 外枠。床に彫られた「区画」であることを示す
  canvas.rect(0, 0, size, 3, c.mark.deep);
  canvas.rect(0, size - 3, size, size, c.mark.deep);
  canvas.rect(0, 0, 3, size, c.mark.deep);
  canvas.rect(size - 3, 0, size, size, c.mark.deep);
  heart(canvas, scale, c.mark.deep, inset + 2);
  heart(canvas, scale, c.mark.line, inset);
  return canvas;
}

/**
 * 原画を持たない 4 枚。**残りの 13 枚は `import-textures.ts` が出す**（判断 A）。
 * ここに手続きを足すのは「発注しないと決めた絵」だけにする
 */
const BUILDERS: Record<string, (spec: TextureSpec, colors: SetColors) => Canvas> = {
  'metal_grate.png': (s, c) => metalGrate(s.width, c),
  'shell_plate.png': (s, c) => shellPlate(s.width, c),
  'pedestal_top.png': (s, c) => pedestalTop(s.width, c),
  'mark_glyph.png': (s, c) => markGlyph(s.width, c),
};

const declared = new Set(TEXTURE_SETS.map((set) => set.dir));
for (const colors of SET_COLORS) {
  if (!declared.has(colors.dir)) throw new Error(`${colors.dir} は texture_spec.ts の TEXTURE_SETS に無い`);
}
if (SET_COLORS.length !== TEXTURE_SETS.length) {
  throw new Error(`色表 ${SET_COLORS.length} 件に対しセットは ${TEXTURE_SETS.length} 件。数が合わない`);
}

// 発注表に無いファイルを描いていないこと（表とここが 2 つの正本にならないように）
const ordered = new Set(TEXTURE_SPECS.map((spec) => spec.file));
for (const file of Object.keys(BUILDERS)) {
  if (!ordered.has(file)) throw new Error(`${file} は texture_spec.ts の発注表に無い`);
}

for (const colors of SET_COLORS) {
  const dir = join(OUT_DIR, colors.dir);
  mkdirSync(dir, { recursive: true });
  for (const spec of TEXTURE_SPECS) {
    const build = BUILDERS[spec.file];
    // 原画のある 13 枚は `import-textures.ts` の持ち場。ここでは黙って飛ばす
    if (!build) continue;
    writePngIfChanged(join(dir, spec.file), build(spec, colors).image);
  }
  console.log(`書き出した: ${colors.dir}/（${Object.keys(BUILDERS).length} 枚）`);
}
