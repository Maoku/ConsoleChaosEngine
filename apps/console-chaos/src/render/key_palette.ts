/**
 * 基準画の色の基準表（KV-01、`Docs/GRAPHICS_KEY_VISUAL_PLAN.md` §1.2）。
 *
 * **色の出どころを 1 つにする。** 基準画（`Docs/console-chaos-title.png`）から実測した色を
 * ここに置き、`tools/make-textures.ts`（テクスチャの色表）と
 * `src/generation/profiles.ts`（背景の色）は**ここだけを読む**。
 * 2 箇所に同じ 16 進数が書かれる状態を作らないための表であり、ロジックは持たない。
 *
 * 第1世代だけは事情が違う。固定 54 色（`quantize/master_palette.ts`）から選ぶしかないので、
 * 「基準画のどの色を、54 色のどれで担うか」を `FC_PALETTE` が宣言する。
 * **これは最近傍ではなく宣言である**（§2 の実測を参照）。
 */
import { MASTER_PALETTE_RGB, nearestMasterIndex } from '@console-chaos/engine';

export type Rgb = readonly [number, number, number];

/** 基準画から実測した色（§1.2 の 8 行）。名前は用途であって、色名ではない */
export const KEY_COLORS = {
  /** 題字の桃。第1・第2世代の差し色 */
  titlePink: [0xf8, 0x58, 0x88],
  /** 髪・淡桃 */
  palePink: [0xf8, 0xb8, 0xc8],
  /** 赤。紋（ハート）と扉 */
  red: [0xe8, 0x38, 0x48],
  /** 濃赤 */
  deepRed: [0x98, 0x08, 0x28],
  /** 生成り。第1世代の城壁の地 */
  cream: [0xf8, 0xe8, 0xd8],
  /** 空色。第2世代の空（上） */
  sky: [0x18, 0x88, 0xe8],
  /** 空色（下）。地平へ向かって明るくなる */
  skyLight: [0x48, 0x98, 0xe8],
  /** 灰紫。第3世代の岩 */
  stone: [0x58, 0x48, 0x68],
  /** 灰紫（暗）。第3世代の遠景 */
  stoneDark: [0x38, 0x38, 0x58],
  /** 深紺。第4世代の夜 */
  night: [0x08, 0x08, 0x28],
  /** 深青。第4世代の空の下端 */
  nightBlue: [0x08, 0x18, 0x68],
  /** 白。光の帯 */
  white: [0xf8, 0xf8, 0xf8],
  // --- ステージの基準画から実測した色（SG-02、GRAPHICS_STAGE_PLAN §1.1） ---
  // 題字の基準画とは別の 1 枚（`Docs/concept/stage-02-emerald-sky-gen-04.png`）である。
  // **既存の 12 個は消さない。** `pipeline.ts` の切替の帯が titlePink / sky / white を読む
  /** 空・天頂。昼の空の上端 */
  skyDay: [0x15, 0x74, 0xe5],
  /** 空・地平。上端より明るく、地平へ向かって淡くなる */
  skyHorizon: [0x69, 0xc4, 0xfd],
  /** 草・日向。黄緑で彩度が高い */
  grass: [0xb5, 0xbb, 0x27],
  /** 針葉樹。草より 3 段暗い緑 */
  conifer: [0x1a, 0x49, 0x36],
  /** 道の石畳。砂色。草と明度で大きく離れている */
  sand: [0xf9, 0xc9, 0x76],
  /** 砂岩ブロックの側面。天面（草）と色相でも明度でも分かれる */
  sandstone: [0x94, 0x6a, 0x47],
  /** 遠景メサ・日向。赤茶 */
  mesa: [0xe6, 0x98, 0x8a],
  /**
   * 最遠のメサ。**日向の `mesa` が空色へ溶けた姿**（上位計画 §3 の決定 6）。
   * 「遠いものが背景色へ抜ける」の行き先そのものなので、第3世代の空と霧の色でもある
   */
  mesaFar: [0x78, 0x86, 0xaa],
} as const satisfies Record<string, Rgb>;

export type KeyColorName = keyof typeof KEY_COLORS;

/**
 * 第1世代が使う 7 色。
 *
 * `index` は固定 54 色の番号、`source` は**テクスチャや背景に実際に置く色**である。
 * 2 つを分けているのは、置いた色がそのまま出るとは限らないため。
 * 第1世代は明るさを掛けてから量子化するので（`tools/texture_spec.ts` の `QUANTIZE_LEVELS`）、
 * 陰影の付いた面では別の番号へ落ちる。`source` はその 5 段すべてで系統が変わらない値を
 * 総当たりで選んである（§2 の実測）。
 */
export interface FcColor {
  /** 基準画のどの色を担うか */
  key: KeyColorName;
  /** 固定 54 色の番号。`source` を明るさ 1.0 で量子化するとここへ落ちる */
  index: number;
  /** テクスチャ・背景に置く色 */
  source: Rgb;
  /**
   * 陰影を受ける面で使ってよいか。
   *
   * **偽の色は背景（BG 面の一番奥）でしか使えない。** 白と生成りは 54 色の最上段にあり、
   * 明るさ 0.7 を掛けると中間灰（152,150,152）へ落ちて形が消える。
   * 背景は陰影を持たない 1 枚の面なので、そこでだけ本来の明るさで出せる
   */
  lit: boolean;
}

export const FC_PALETTE: readonly FcColor[] = [
  /** 空。上下で色を変えないので、第1世代の空はこの 1 色そのものになる */
  { key: 'skyDay', index: 27, source: [0x48, 0x98, 0xe8], lit: true },
  /** 草。天面と草木の明部 */
  { key: 'grass', index: 34, source: [0xa0, 0xa8, 0x00], lit: true },
  /** 針葉樹と、緑の深い陰。第1世代でいちばん暗い有彩色 */
  { key: 'conifer', index: 22, source: [0x28, 0x70, 0x00], lit: true },
  /**
   * 道の砂色。
   *
   * **黄色 `[248,216,96]` を置くと砂色 `[228,196,144]` として出る**（KV-01 と同じ事情）。
   * 実測の `#f9c976` をそのまま置くと 54 色の最上段の低彩度の帯へ落ち、
   * 明るさ 0.7 で中間灰になって形が消える
   */
  { key: 'sand', index: 46, source: [0xf8, 0xd8, 0x60], lit: true },
  /** 砂岩の側面。草・砂色のどちらとも明度で離れる */
  { key: 'sandstone', index: 20, source: [0x78, 0x38, 0x00], lit: true },
  /** 遠景のメサ。第1世代で唯一の赤系 */
  { key: 'mesa', index: 32, source: [0xe8, 0x68, 0x60], lit: true },
  /** 白。門の光・雲・滝。**陰影を受けると灰へ落ちるので陰影を持たない絵の専用**（§2） */
  { key: 'white', index: 53, source: [0xf8, 0xf8, 0xf8], lit: false },
];

/** 名前から第1世代の色を引く。表に無い色を第1世代で使おうとしたらその場で落ちる */
export function fcColorOf(key: KeyColorName): FcColor {
  const found = FC_PALETTE.find((color) => color.key === key);
  if (!found) throw new Error(`${key} は第1世代の 7 色に無い（key_palette.ts の FC_PALETTE）`);
  return found;
}

// --- 表と固定 54 色の食い違いを起動時に落とす（master_palette.ts と同じ作法） ---
for (const { key, index, source } of FC_PALETTE) {
  const actual = nearestMasterIndex(source[0], source[1], source[2]);
  if (actual !== index) {
    throw new Error(
      `FC_PALETTE の ${key}: source が固定 54 色の ${actual} 番 [${MASTER_PALETTE_RGB[actual]!.join(',')}] へ落ちる。` +
        `宣言は ${index} 番 [${MASTER_PALETTE_RGB[index]!.join(',')}]`,
    );
  }
}
