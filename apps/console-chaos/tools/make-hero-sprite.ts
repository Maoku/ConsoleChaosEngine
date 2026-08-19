/**
 * プレイヤースプライトの生成（T2-09 で第1世代、T2-11 で第2世代）。
 *
 * 素材は `Docs/hero-gen-N-animations/` に置かれた連番フレーム（256×256 のセルが 16 枚）で、
 * ここはそれを**ゲームが読める 1 枚のアトラス**（`public/assets/sprites/hero_genN.png`）へ
 * まとめるだけの決定論的な変換である。素材そのものには手を入れない。
 *
 * 正本は素材ではなくこのスクリプトの出力とする（asset-rules.md §9 と同じ考え方）。
 * 素材を差し替えたら、もう一度これを走らせる。
 *
 *   npx tsx tools/make-hero-sprite.ts     （= npm run make:hero-sprite）
 *
 * **世代ごとに処理は分けない。** 素材は同じ工程・同じ寸法で作られており（各 `README.md`）、
 * 外接矩形の測り方も共通化できることを検証済みである（`Docs/VALIDATION.md`）。
 * 世代の差は絵そのものと、その後段の色量子化が出す。
 *
 * ここで行う変換は 3 つだけで、それぞれ理由がある。
 *
 * 1. **横位置の付け直し**
 *    素材の歩行は「その場で歩く」ではなく**セルの中を左へ歩き去る**形で描かれており、
 *    頭の位置が 6 コマで 70 画素以上も流れる（第1世代 74.5px / 第2世代 71.5px）。
 *    そのまま使うと、歩くたびにキャラクタが左右へ滑る。
 *    そこで不透明部分の**外接矩形の中心**をセルの中心へ揃える。
 *    どのコマで測るかはクリップによる（`HorizontalAnchor`）。
 *
 * 2. **縦位置の付け直し**（クリップごと・全コマ共通の移動量）
 *    縦は横と違い、値そのものに意味がある（歩きの上下動、ジャンプの浮き）。
 *    だから**コマごとには動かさず**、クリップの中でいちばん深い足がセルの下端に来るよう
 *    クリップ全体を同じ量だけ動かす。結果として**セルの下端が接地線**になる。
 *
 * 3. **1/4 への縮小**
 *    1 ワールド単位 = 32 画素（`level/schema.ts`）なので、セル 64 画素 = 2m。
 *    第1・第2世代はどちらも内部解像度 256×224 なので、等倍で表示でき画素が滲まない。
 *    透明画素の色が混ざらないよう、乗算済みアルファで平均してから戻す。
 *    どちらの世代も絵に半透明を持たせないので、アルファは最後に 0 か 255 へ落とす。
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodePng, writePngIfChanged, type RgbaImage } from '@console-chaos/asset-pipeline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/assets/sprites');

/**
 * 作るアトラス。**並びと出力名は `generation/profiles.ts` の `player.file` と対応する。**
 * 世代を増やすときはここへ 1 行足す（処理そのものは触らない）
 */
const SHEETS: ReadonlyArray<{ label: string; sourceDir: string; outFile: string }> = [
  { label: '第1世代', sourceDir: 'Docs/hero-gen-1-animations', outFile: 'hero_gen1.png' },
  { label: '第2世代', sourceDir: 'Docs/hero-gen-2-animations', outFile: 'hero_gen2.png' },
];

/** 素材のセルの一辺（画素）。`character-scale-profile.json` の `cell_size` と一致する */
const SOURCE_CELL = 256;
/** 出力のセルの一辺（画素）。32px/m なので 2m ぶん */
const CELL = 64;
/** アトラスの列数。16 コマがちょうど 4×4 に収まり、256×256（§7 の上限）で足りる */
const COLUMNS = 4;
/** 不透明とみなすアルファの下限。生成物の縁にはごく薄い画素が残っている */
const ALPHA_FLOOR = 8;
/** 縮小後に不透明として残す被覆率のしきい値 */
const COVERAGE_CUTOFF = 128;

/**
 * 横位置をどのコマで測るか。
 *
 * 外接矩形の中心は「体の中心」の近似でしかないので、
 * **片側だけが大きく動くクリップでは体まで一緒に流れてしまう**。
 * 素材ごとの外接矩形を実測し、clipの動きに応じて使い分ける。
 */
type HorizontalAnchor =
  /** コマごとに測る。手足が前後へ等しく振れるクリップ（歩き・ジャンプ）はこれで揃う */
  | 'per-frame'
  /** 先頭コマで測った量をクリップ全体に使う。片腕だけが伸びるクリップ向け */
  | 'first-frame';

/**
 * 素材のクリップ。並びがそのままアトラスのセル番号になる
 *（`generation/profiles.ts` の `clips[].first` がこの並びを指す）。
 */
const CLIPS: ReadonlyArray<{ dir: string; frames: number; anchor: HorizontalAnchor }> = [
  // 歩き：外接矩形の中心が 6 コマで 70px 以上流れる。コマごとに引き戻す
  { dir: 'walk', frames: 6, anchor: 'per-frame' },
  // ジャンプ：素材が既にセル中央で揃っている（この処理を通しても移動量は 0〜1px に収まる）
  { dir: 'jump', frames: 6, anchor: 'per-frame' },
  // 手を前に出す：立ち位置は動かず腕だけが右へ伸びる。
  // コマごとに測ると腕の長さぶん体が左へ後ずさりするので、腕を出す前の 1 コマ目で測る
  { dir: 'hand-forward', frames: 4, anchor: 'first-frame' },
];

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 不透明部分の外接矩形。1 画素も無ければ例外にする（素材の取り違えを黙って通さない） */
function boundsOf(image: RgbaImage, label: string): Bounds {
  const box: Bounds = { minX: image.width, minY: image.height, maxX: -1, maxY: -1 };
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3]! < ALPHA_FLOOR) continue;
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
    }
  }
  if (box.maxX < 0) throw new Error(`${label}: 不透明な画素が 1 つも無い`);
  return box;
}

/**
 * セルを整数画素ぶん平行移動しながら 1/4 に縮小し、アトラスへ書き込む。
 *
 * 平均は乗算済みアルファで取る。素直に RGB を平均すると、
 * 透明部分に残っている色（この素材では白）が輪郭へ滲み出す。
 */
function blitCell(source: RgbaImage, shiftX: number, shiftY: number, atlas: RgbaImage, cellIndex: number): void {
  const scale = SOURCE_CELL / CELL;
  const originX = (cellIndex % COLUMNS) * CELL;
  const originY = Math.floor(cellIndex / COLUMNS) * CELL;

  for (let oy = 0; oy < CELL; oy++) {
    for (let ox = 0; ox < CELL; ox++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          // 出力画素 → 素材の画素。平行移動は「素材のどこを読むか」の側で戻す
          const px = ox * scale + sx - shiftX;
          const py = oy * scale + sy - shiftY;
          if (px < 0 || py < 0 || px >= source.width || py >= source.height) continue;
          const i = (py * source.width + px) * 4;
          const alpha = source.data[i + 3]!;
          if (alpha < ALPHA_FLOOR) continue;
          r += source.data[i]! * alpha;
          g += source.data[i + 1]! * alpha;
          b += source.data[i + 2]! * alpha;
          a += alpha;
        }
      }
      const target = ((originY + oy) * atlas.width + originX + ox) * 4;
      // 被覆率が半分に満たない画素は抜く（第1世代に半透明は無い）
      if (a / (scale * scale) < COVERAGE_CUTOFF) continue;
      atlas.data[target] = Math.round(r / a);
      atlas.data[target + 1] = Math.round(g / a);
      atlas.data[target + 2] = Math.round(b / a);
      atlas.data[target + 3] = 255;
    }
  }
}

const TOTAL_FRAMES = CLIPS.reduce((sum, clip) => sum + clip.frames, 0);

/** 素材 1 式 → アトラス 1 枚。世代ごとの分岐はここにも下位にも無い */
function buildSheet(sheet: (typeof SHEETS)[number]): void {
  const sourceDir = join(ROOT, sheet.sourceDir);
  const rows = Math.ceil(TOTAL_FRAMES / COLUMNS);
  const atlas: RgbaImage = {
    width: COLUMNS * CELL,
    height: rows * CELL,
    data: new Uint8Array(COLUMNS * CELL * rows * CELL * 4),
  };
  if (atlas.width > 256 || atlas.height > 256) {
    throw new Error(`アトラスが ${atlas.width}×${atlas.height}。asset-rules.md §7 の上限 256×256 を超える`);
  }

  console.log(`${sheet.label}スプライトの生成（${sheet.sourceDir} / 素材 ${SOURCE_CELL}px → セル ${CELL}px）`);
  let cellIndex = 0;
  for (const clip of CLIPS) {
    const frames: RgbaImage[] = [];
    const boxes: Bounds[] = [];
    for (let i = 1; i <= clip.frames; i++) {
      const label = `${clip.dir}-${i}`;
      const image = decodePng(readFileSync(join(sourceDir, clip.dir, `${label}.png`)));
      if (image.width !== SOURCE_CELL || image.height !== SOURCE_CELL) {
        throw new Error(`${label}: ${image.width}×${image.height}。素材のセルは ${SOURCE_CELL}×${SOURCE_CELL}`);
      }
      frames.push(image);
      boxes.push(boundsOf(image, `${sheet.label} ${label}`));
    }

    // 縦はクリップ全体で同じ量だけ動かす（上下動を潰さないため）
    const deepest = Math.max(...boxes.map((box) => box.maxY));
    const shiftY = SOURCE_CELL - 1 - deepest;

    const centerOf = (box: Bounds): number => Math.round((SOURCE_CELL - 1) / 2 - (box.minX + box.maxX) / 2);
    frames.forEach((image, i) => {
      const box = boxes[i]!;
      const shiftX = centerOf(boxes[clip.anchor === 'first-frame' ? 0 : i]!);
      blitCell(image, shiftX, shiftY, atlas, cellIndex);
      console.log(
        `  セル ${String(cellIndex).padStart(2)}  ${`${clip.dir}-${i + 1}`.padEnd(15)}` +
          ` 横 ${String(shiftX).padStart(4)}px  縦 ${String(shiftY).padStart(3)}px` +
          `  身長 ${String(box.maxY - box.minY + 1).padStart(3)}px（${(((box.maxY - box.minY + 1) / SOURCE_CELL) * 2).toFixed(2)}m）`,
      );
      cellIndex++;
    });
  }

  writePngIfChanged(join(OUT_DIR, sheet.outFile), atlas);
  console.log(`書き出した: public/assets/sprites/${sheet.outFile}（${atlas.width}×${atlas.height}、${TOTAL_FRAMES} コマ）`);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const sheet of SHEETS) buildSheet(sheet);
