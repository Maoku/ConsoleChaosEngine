/**
 * 4 世代のプロファイル定義（GAME_PLAN §4、IMPLEMENTATION_PLAN §5.2.1）。
 *
 * **このファイルは定数のみを持ち、ロジックを持たない。**
 * この 1 ファイルを読めば 4 世代の全差分が把握できる状態を維持する。
 *
 * 不変条件 I2: ゲームロジックに世代の分岐を書かない。参照するのはここの値のみ。
 * 世代 ID を直接分岐してよいのは本ファイルと render/pipeline.ts の 2 つだけで、
 * ESLint ルール chaos/no-generation-branch が機械的に検査する。
 *
 * GAME_PLAN §4 の構造に対する本実装の追加・変更点（いずれも実装上の必要から）:
 * - `projection` の値は '2D' / '3D' ではなく 'ortho2d' / 'perspective3d'。
 *   投影は「Z を見るかどうか」の指定であり、次元の呼称ではないため
 * - `signal` を追加（CRT プリセットの選択に使う。§5.4.5）
 * - `textureFilter` を追加（実機のフィルタ有無を明示するため）
 * - `animationHz` を追加（ボーンアニメのコマ落ちを再生時刻の量子化で表す。T0-19 で確認）
 * - `vertexQuantize` は GAME_PLAN の 1.0 に対し 2 を暫定値とする
 *   （T0-08 の計測所見。最終決定はフェーズ 1 のプレイテスト）
 * - `affinePlane` を追加（S-1 を第2世代専用に戻すために要る。T2-03。
 *   経緯は `Docs/PHASE2_GIMMICK_PLAN.md` §6 の決定 4）
 * - `player` を追加（プレイヤーの見た目。T2-07 でモデル、T2-09 でスプライトも選べるようにした。
 *   T2-11 で第2世代もスプライトへ移し、2D の 2 世代が絵・3D の 2 世代がモデルになった）
 * - `art` を追加（世代ごとの色と背景。KV-02。
 *   経緯は `Docs/GRAPHICS_KEY_VISUAL_PLAN.md` §3 の決定 2）
 */
import { KEY_COLORS, fcColorOf, type Rgb } from '@/render/key_palette';

export const GENERATION_IDS = ['FC', 'SFC', 'PS1', 'PS2'] as const;
export type GenerationId = (typeof GENERATION_IDS)[number];

/**
 * 表示名は内部 ID と完全に分離する（GAME_PLAN §7.1.1）。
 * 本作は実機のエミュレータではないため、UI には実機名を一切出さない。
 */
export const DISPLAY_NAMES: Record<GenerationId, { channel: string; label: string }> = {
  FC: { channel: 'CH 1', label: '第1世代' },
  SFC: { channel: 'CH 2', label: '第2世代' },
  PS1: { channel: 'CH 3', label: '第3世代' },
  PS2: { channel: 'CH 4', label: '第4世代' },
};

/** 世界の見え方。2D は「Z を見ない投影」であって、別の世界ではない（不変条件 I1） */
export type ProjectionMode = 'ortho2d' | 'perspective3d';

/** 映像出力の系統。CRT プリセットの選択に使う */
export type SignalKind = 'rf' | 'composite' | 'svideo' | 'component';

export type PaletteMode = 'fixed54' | 'rgb555' | 'truecolor';
export type SynthKind = 'psg' | 'brr' | 'adpcm' | 'streaming';
export type DirectionalKind = 'dpad4' | 'dpad8' | 'analog';

export interface VideoProfile {
  internalWidth: number;
  internalHeight: number;
  projection: ProjectionMode;
  signal: SignalKind;
  paletteMode: PaletteMode;
  /** 同時発色数。-1 は制限なし */
  maxSimultaneousColors: number;
  /** パレット割当のブロック辺（画素）。0 はブロック制限なし */
  paletteBlockSize: number;
  /** 走査線あたりのスプライト上限。-1 は制限なし */
  spritesPerScanline: number;
  /** レベル要素を丸めるグリッド（画素）。0 はグリッドなし */
  tileSnap: number;
  alphaBlend: boolean;
  /**
   * 画面いっぱいの 1 枚の面を、回転・拡大しながら描けるか（S-1、T2-03）。
   *
   * 第2世代だけが持つ署名的な機能。3D ではなく「1 枚の面を毎走査線ごとに変形する」
   * 仕組みなので、透視投影を持つ世代がその上位互換になるわけではない。
   * したがって**第2世代のみ true**（第3・第4世代も false）。
   *
   * この項目は S-1 のために T2-03 で追加した。追加の経緯は
   * `Docs/PHASE2_GIMMICK_PLAN.md` §6 の決定 4。
   */
  affinePlane: boolean;
  /** 深度バッファを持つか。第3世代は持たず、描画順（三角形ソート）で解決する */
  depthBuffer: boolean;
  /** UV を遠近補正なしで補間するか */
  affineTexture: boolean;
  /** 頂点量子化の粒度。0 は量子化しない */
  vertexQuantize: number;
  dynamicLight: boolean;
  textureFilter: 'nearest' | 'linear';
  /** ボーンアニメの再生レート（実機のコマ落ちを時刻の量子化で表す） */
  animationHz: number;
}

/** XZ 平面上の向き（正規化済み）。カメラの視線と、そこから作る移動の基底に使う */
export type ForwardXZ = readonly [number, number];

/**
 * 真横から見る構図。カメラは +Z 側に立ち、視線は奥（-Z）へ向く。
 * 2D 世代の画作りそのもので、第3世代は 3D になっても構図を受け継ぐ。
 */
const LOOK_SIDE_ON: ForwardXZ = [0, -1];

/**
 * 通路の奥（+X）へ向く構図。カメラはプレイヤーの背中側に立つ。
 *
 * **向きは固定で、プレイヤーの左右反転では回らない。** 移動がカメラ相対である以上、
 * カメラの向きを `facing` に追従させると「後ろへ倒す → 向きが反転 → カメラが回る →
 * 後ろが入れ替わる」の帰還路ができ、真横あたりで振動する。
 * 通路の進行方向に固定すれば、後ろへ倒したときはカメラの方へ歩いてくるだけで済む。
 */
const LOOK_ALONG_CORRIDOR: ForwardXZ = [1, 0];

/**
 * カメラの構図（T2-08）。
 *
 * 距離の値はすべて**プレイヤーの中心からの相対量**で、向きは `forward` が決める。
 * 世代ごとの画作りの差はここだけに出す。`gameplay/scene.ts` は
 * この値から位置と注視点を組み立てるだけで、世代を知らない。
 *
 * `forward` は画作りだけの値ではない。**移動もこの向きを基底に取る**（カメラ相対。
 * `gameplay/player.ts`）ので、「奥へ倒せば画面の奥へ進む」がどの構図でも成り立つ。
 */
export interface CameraProfile {
  /** カメラの視線の水平成分。カメラはこれの逆側に立つ */
  forward: ForwardXZ;
  /** プレイヤーから後ろへ引く水平距離（ワールド単位） */
  distance: number;
  /** プレイヤーの中心から上へ持ち上げる高さ */
  height: number;
  /** 注視点をプレイヤーの中心から上へずらす量 */
  targetHeight: number;
  /** 注視点をプレイヤーより前方（進行方向）へ置く距離。0 ならプレイヤーそのものを見る */
  lookAhead: number;
}

export interface AudioProfile {
  /** 同時発音数 */
  channels: number;
  synth: SynthKind;
  /** サンプリング周波数。0 は「サンプルを持たない」（合成のみ） */
  sampleRate: number;
  reverb: boolean;
  positional: boolean;
}

export interface InputProfile {
  directional: DirectionalKind;
  /** 第1世代は斜め移動を禁止する（GAME_PLAN §4.1 の意図的な差分） */
  allowDiagonal: boolean;
  buttons: readonly string[];
  analogAxes: 0 | 2 | 4;
  pressureSensitive: boolean;
  rumble: boolean;
}

/**
 * プレイヤーの基本アクション（GAME_PLAN §5.3）。
 *
 * **能力の総量はどの世代でも等価にする。**
 * 第1世代は「移動が粗い」代わりに「1 マス単位で正確に止まれる」など、
 * 得るものと失うものを必ずペアにする。
 */
export interface ActionProfile {
  /** 移動の刻み（ワールド単位）。0 は連続 */
  moveSnap: number;
  /** 最高速度（m/s） */
  moveSpeed: number;
  /** ジャンプの高さが可変か */
  variableJump: boolean;
  wallJump: boolean;
  /** 攻撃の向き */
  attack: 'forward' | 'forward_charge' | 'omni' | 'omni_lock';
  /** アナログによる微調整が可能か */
  fineControl: boolean;
}

/** ゲーム側が要求するクリップ。`gameplay/scene.ts` が状態から決める */
export type PlayerClip = 'idle' | 'walk' | 'jump';

export interface PlayerClipRef {
  /** アセット内のアニメーション名 */
  animation: string;
  /**
   * 先頭のポーズで止めるか。
   *
   * 第4世代のモデルは待機のクリップを持たないので、歩行の 1 コマ目を
   * 立ちポーズとして流用する。止めないと、その場で足踏みして見える。
   */
  freeze: boolean;
}

/**
 * プレイヤーモデル（T2-07）。
 *
 * **世代の差はモデルそのものにも出す。** 第3・第4世代は実機相当の
 * ポリゴン数を持つキャラクタを使う。2D の 2 世代はモデルを持たない
 *（絵で描く。`PlayerSpriteProfile`）ので、この型を使うのは 3D の 2 世代だけになった。
 *
 * クリップ名はアセットごとに違うので、ゲーム側の名前との対応をここで持つ。
 * これがないと `scene.ts` がアセットの命名を知ることになる。
 */
export interface PlayerModelProfile {
  kind: 'model';
  /** `public/assets/models/` のファイル名 */
  file: string;
  /**
   * アセットの中でモデルの正面が向いている軸（T2-08）。
   *
   * 自前で書き出したモデルは glTF の慣例どおり -Z を向くが、外部アセットは
   * +Z を向いていることがある。**アセットを回すのではなく、この宣言で吸収する**
   *（アセットは差し替えるだけで済ませたい）。描画のときに半回転が入る。
   */
  front: '-Z' | '+Z';
  clips: Record<PlayerClip, PlayerClipRef>;
}

/** スプライト 1 クリップぶんの再生指定（T2-09） */
export interface PlayerSpriteClip {
  /** アトラス内の先頭セル番号（左上から行優先） */
  first: number;
  /** コマ数 */
  frames: number;
  /**
   * 1 コマの表示時間（秒）。**素材が持つ間隔をそのまま書く。**
   * ボーンアニメと違い、コマ落ちは素材そのものが持っている（`render/sprite_sheet.ts`）
   */
  frameSeconds: number;
  /** 末尾まで来たら先頭へ戻るか。偽なら末尾のコマで止まる */
  loop: boolean;
}

/**
 * プレイヤースプライト（第1世代は T2-09、第2世代は T2-11）。
 *
 * **2D の 2 世代は「絵」でできている。** 3D の 2 世代が骨とポリゴンでキャラクタを作るのに対し、
 * こちらは 1 枚の絵をコマ送りする。深度も動的ライティングも持たない世代では、
 * ポリゴンで作ったものを量子化するより素材そのもののほうが実機の見えに近い。
 *
 * 絵は `tools/make-hero-sprite.ts` が `Docs/hero-gen-N-animations/` から組む。
 * **セルの下端が接地線**で、セル 1 つが `worldSize` メートル四方を占める。
 */
export interface PlayerSpriteProfile {
  kind: 'sprite';
  /** `public/assets/sprites/` のファイル名 */
  file: string;
  /** セルの一辺（画素） */
  cell: number;
  /** アトラスの列数 */
  columns: number;
  /** アトラスの行数 */
  rows: number;
  /**
   * セル 1 つがワールドで占める大きさ（メートル）。
   * `cell / PIXELS_PER_WORLD_UNIT` と一致させると画素が等倍で並ぶ（64px / 32 = 2m）
   */
  worldSize: number;
  clips: Record<PlayerClip, PlayerSpriteClip>;
}

/** プレイヤーの見た目。骨のあるモデルか、コマ送りの絵か */
export type PlayerVisual = PlayerModelProfile | PlayerSpriteProfile;

/**
 * 2D 世代のプレイヤースプライト（第1世代は T2-09、第2世代は T2-11）。
 *
 * 素材（`Docs/hero-gen-N-animations/`）は右向きの側面図で、歩き 6 コマ・
 * ジャンプ 6 コマ・手を前に出す 4 コマ。この並びがそのままアトラスのセル番号になる。
 * 左を向くときは描画側が絵を左右反転する。
 *
 * **2 つの世代で違うのは絵だけで、並びも刻みも同じ。** 素材が同じ工程・同じ寸法で
 * 作られており（各 `README.md` の表）、`tools/make-hero-sprite.ts` も同じ変換を掛ける。
 * 世代の差は絵そのものと、その後段の色量子化（固定 54 色 / RGB555）が出す。
 */
function heroSprite(file: string): PlayerSpriteProfile {
  return {
    kind: 'sprite',
    file,
    cell: 64,
    columns: 4,
    rows: 4,
    worldSize: 2,
    clips: {
      /**
       * 素材に待機のクリップは無い。「手を前に出す」の 1 コマ目が腕を下ろした立ち姿なので、
       * そこで止めて待機にする（第4世代が歩行の 1 コマ目を立ちポーズに使うのと同じ手）
       */
      idle: { first: 12, frames: 1, frameSeconds: 0.14, loop: false },
      walk: { first: 0, frames: 6, frameSeconds: 0.11, loop: true },
      // 滞空はコマ数より長くなり得る。繰り返すと着地の直前に踏み切りの絵が出るので止める
      jump: { first: 6, frames: 6, frameSeconds: 0.115, loop: false },
    },
  };
}

/** 2D 世代の構図。真横から、正射影の箱に収まる距離で見る */
const SIDE_ON_2D_CAMERA: CameraProfile = {
  forward: LOOK_SIDE_ON,
  distance: 14,
  height: 0,
  targetHeight: 0,
  lookAhead: 0,
};

/**
 * 背景の層（KV-02）。**層は世代ごとに最大 2 枚**で、これ以上は増やさない。
 * 多重スクロールを持つのは第2世代だけなので、汎用のパララックス機構は作らない
 *（GAME_PLAN §11.1.1「汎用の抽象を作らない」）。
 *
 * 計画 §3 の決定 2 の素案は `{ texture, scroll }` の 2 項目だったが、
 * それだけでは**層を画面のどこに置くか**が決まらない。
 * 地平の高さと層の厚みは世代ごとに違う（第2世代の雲は上、岩の稜線は下）ので、
 * 置き場の 2 項目（`bottom` / `height`）と、横の繰り返し数を足してある。
 */
export interface BackdropLayer {
  /** `public/assets/textures/<textureSet>/` の中のファイル名 */
  texture: string;
  /** 画面の横幅あたりの繰り返し数。0 にはしない（層を持たないときは層ごと null） */
  repeat: number;
  /**
   * カメラが横へ 1m 動いたときに、層が進む UV の量。
   * **小さいほど遠い。** 2 枚に違う値を入れると多重スクロールになる。
   *
   * **床と同じ速さは `repeat / 8`**（2D 世代の画面は横 8m ちょうど。
   * `internalWidth 256 / PIXELS_PER_WORLD_UNIT 32`）。値はここに UV で置くが、
   * 根拠は必ずこの比で書く。生の UV で書くと `repeat` を変えたときに必ずズレる（BR-01）
   */
  scroll: number;
  /**
   * カメラが縦へ 1m 動いたときに、層が上下する量（画面比 / m。BR-01 / BR-02）。
   *
   * **床と同じ速さは `1 / 7` ≒ 0.143**（画面の縦は 7m = `orthoHeight`）。
   * 縦のパララックスを持たない世代は 0。
   *
   * 動かすのは層の**置き場**（`bottom`）だけで、UV の v は動かさない。
   * v をずらすと帯の中で絵が伸び縮みして見切れる（計画 §2 の決定 2）
   */
  scrollY: number;
  /**
   * 層の下端。画面の下から測った比（0 = 画面下端、1 = 上端）。
   * **カメラ Y = 0 のときの位置**として定義する（`scrollY` がここから上下させる）
   */
  bottom: number;
  /** 層の高さ（画面の高さに対する比） */
  height: number;
}

/**
 * 背景（BG 面の一番奥。KV-02）。
 *
 * `sky` は上端と下端の色で、同じ値を入れれば単色になる。
 * 層は最大 2 枚で、`null` は「その層を持たない」。
 */
/**
 * RGB555 へ丸める（第2世代の `paletteMode`。SG-03）。
 *
 * **空の色を `KEY_COLORS` から 1 か所で作るための式である。** 4 世代とも同じ昼の空を
 * 見ているので、色の出どころは 1 つでよい。世代差は「その空をどう出せるか」に出る
 *（固定 54 色 / RGB555 / 色が乏しい / そのまま）。
 * 丸めた 16 進数をここへ書き写すと、`key_palette.ts` と 2 つの正本ができる
 */
function rgb555([r, g, b]: Rgb): Rgb {
  return [r & 0xf8, g & 0xf8, b & 0xf8];
}

export interface BackdropProfile {
  sky: readonly [Rgb, Rgb];
  /** 遠景の層 */
  far: BackdropLayer | null;
  /** 近景の層。多重スクロールを持つ世代だけが使う */
  near: BackdropLayer | null;
}

/**
 * 世代ごとの見た目（KV-02、計画 §3 の決定 2）。
 *
 * **不変条件 I2 を守れる置き場はここしかない。** 材質表（`render/material.ts`）は
 * 世代を知らないままにしておきたいので、「どのセットの絵を貼るか」はここが持ち、
 * ディレクトリ名を前に付けるのは描画側（`render/renderer3d.ts`）だけの仕事にする。
 *
 * 色は**乗算ではなくテクスチャセットの差し替え**で出す（計画 §3 の決定 3）。
 * 乗算で色を変えると、第1世代の量子化で中間灰へ落ちる保証が崩れる。
 */
export interface ArtProfile {
  /** `public/assets/textures/<textureSet>/` のディレクトリ名 */
  textureSet: string;
  backdrop: BackdropProfile;
  /**
   * 遠景を背景色へ溶かす濃さ（1m あたり）。0 は霧なし。
   *
   * 計画の素案には無いが、KV-06 の「遠景が背景色へ抜ける」はこれが無いと出せない。
   * **色は背景の下端色をそのまま使う**ので、ここが持つのは濃さだけ。
   * 画素ごとの色の混ぜであり、三角形の並べ替えには一切触れない
   *（深度バッファを持たない世代でも描画順が壊れない）
   */
  fogDensity: number;
}

export interface GenerationProfile {
  id: GenerationId;
  video: VideoProfile;
  camera: CameraProfile;
  audio: AudioProfile;
  input: InputProfile;
  action: ActionProfile;
  player: PlayerVisual;
  art: ArtProfile;
}

/** Record を使うことで、世代を追加したときにコンパイルエラーで漏れが分かる */
export const PROFILES: Record<GenerationId, GenerationProfile> = {
  FC: {
    id: 'FC',
    video: {
      internalWidth: 256,
      internalHeight: 224,
      projection: 'ortho2d',
      signal: 'rf',
      paletteMode: 'fixed54',
      maxSimultaneousColors: 25,
      paletteBlockSize: 16,
      spritesPerScanline: 8,
      tileSnap: 8,
      alphaBlend: false,
      affinePlane: false,
      depthBuffer: false,
      affineTexture: false,
      vertexQuantize: 0,
      dynamicLight: false,
      textureFilter: 'nearest',
      animationHz: 6,
    },
    camera: SIDE_ON_2D_CAMERA,
    audio: { channels: 5, synth: 'psg', sampleRate: 0, reverb: false, positional: false },
    input: {
      directional: 'dpad4',
      allowDiagonal: false,
      buttons: ['jump', 'action'],
      analogAxes: 0,
      pressureSensitive: false,
      rumble: false,
    },
    action: {
      moveSnap: 0.25,
      moveSpeed: 4.5,
      variableJump: false,
      wallJump: false,
      attack: 'forward',
      fineControl: false,
    },
    player: heroSprite('hero_gen1.png'),
    // 昼の空と赤茶のメサ（SG-03）。空は 54 色の空色 1 色。**上下で色を変えない**のは
    // グラデーションが 16×16 ブロックの色数を食うため（1 ブロックに 3 色 + 抜き）。
    // 遠景はメサ 1 枚だけで、近景を持たない。空 + メサ 3 色 = ブロックあたり 4 番号に収まる
    art: {
      textureSet: 'gen1',
      backdrop: {
        sky: [fcColorOf('skyDay').source, fcColorOf('skyDay').source],
        // **第1世代の背景は世界そのものと同じ面である**（BR-01）。多重スクロールは
        // 第2世代の署名なので、この世代は横も縦も床とぴったり同じ速さで流す。
        //   repeat 1  … 256px の絵が画面 256px にちょうど 1 枚。テクセルと画面画素が 1:1。
        //               SG-01 で絵が 128→256 幅になったので、repeat と scroll を半分にした
        //               （層が画面に占める幅と流れる速さは変わらない。判断 H）
        //   scroll    … repeat / 8 = 0.125（床と同速）
        //   scrollY   … 1 / 7 ≒ 0.143（床と同速）
        //   bottom    … 112/224。**この 0.5 と scrollY = 1/7 の組で、層の下端が
        //               ワールドの y = 0 の面にちょうど乗る**（画面上の y=0 の位置は
        //               0.5 - カメラY/7 で、`bottom - カメラY × scrollY` と同じ式になる）。
        //               メサが地面に立って見えるのはこのため。0.25 だと床より下へ沈む
        //   height    … 128/224。縦も等倍で、絵の縦を潰さない
        far: {
          texture: 'backdrop_far.png',
          repeat: 1,
          scroll: 0.125,
          scrollY: 0.143,
          bottom: 0.5,
          height: 0.5714,
        },
        near: null,
      },
      fogDensity: 0,
    },
  },
  SFC: {
    id: 'SFC',
    video: {
      internalWidth: 256,
      internalHeight: 224,
      projection: 'ortho2d',
      signal: 'composite',
      paletteMode: 'rgb555',
      maxSimultaneousColors: 256,
      paletteBlockSize: 8,
      spritesPerScanline: 32,
      tileSnap: 1,
      alphaBlend: true,
      affinePlane: true,
      depthBuffer: false,
      affineTexture: false,
      vertexQuantize: 0,
      dynamicLight: false,
      textureFilter: 'nearest',
      animationHz: 12,
    },
    camera: SIDE_ON_2D_CAMERA,
    audio: { channels: 8, synth: 'brr', sampleRate: 32000, reverb: true, positional: false },
    input: {
      directional: 'dpad8',
      allowDiagonal: true,
      buttons: ['jump', 'action', 'subAction'],
      analogAxes: 0,
      pressureSensitive: false,
      rumble: false,
    },
    action: {
      moveSnap: 0,
      moveSpeed: 5.0,
      variableJump: false,
      wallJump: true,
      attack: 'forward_charge',
      fineControl: false,
    },
    player: heroSprite('hero_gen2.png'),
    // 空と雲を持つ積み木の国（KV-05）。色数の制限が無いので縦のグラデーションを持てる。
    // **2 枚の層が別々の速さで流れるのはこの世代だけ。**
    // 遠い丘はほとんど動かず、手前の雲は速い。奥行きが横の動きだけで読める。
    //
    // 速さは床速（repeat / 8 = 0.25、縦は 1 / 7 ≒ 0.143）に対する比で決める（BR-02）。
    // 改訂前は 4% と 18% で比が 3.4 倍しかなく、歩いても層が分離しなかった。
    //   far  … 5%。ほとんど止まって見える
    //   near … 45%。歩けば明らかに流れる
    // 速度比 9 倍で、横に歩くだけで 2 枚が別の層として読める。
    // `repeat` はどちらも 1 にして、テクセルと画面画素を 1:1 にする
    //（SG-01 で絵が 128→256 幅になったので、repeat と scroll を半分にした。判断 H）
    art: {
      textureSet: 'gen2',
      backdrop: {
        // 昼の空（SG-03）。**縦のグラデーションを持つのはこの世代の署名**で、
        // 色数の制限が無いことがそのまま姿になる。値は RGB555 へ丸めた実測色
        sky: [rgb555(KEY_COLORS.skyDay), rgb555(KEY_COLORS.skyHorizon)],
        far: {
          texture: 'backdrop_far.png',
          repeat: 1,
          scroll: 0.00625,
          scrollY: 0.007,
          bottom: 0.24,
          height: 0.34,
        },
        near: {
          texture: 'backdrop_near.png',
          repeat: 1,
          scroll: 0.05625,
          scrollY: 0.064,
          bottom: 0.5,
          height: 0.42,
        },
      },
      fogDensity: 0,
    },
  },
  PS1: {
    id: 'PS1',
    video: {
      internalWidth: 320,
      internalHeight: 240,
      projection: 'perspective3d',
      signal: 'svideo',
      paletteMode: 'truecolor',
      maxSimultaneousColors: -1,
      paletteBlockSize: 0,
      spritesPerScanline: -1,
      tileSnap: 0,
      alphaBlend: true,
      affinePlane: false,
      depthBuffer: false,
      affineTexture: true,
      vertexQuantize: 2,
      dynamicLight: false,
      textureFilter: 'nearest',
      animationHz: 30,
    },
    // 3D になっても構図は 2D 世代から受け継ぎ、真横から見る。
    // ただし T2-08 で距離を半分にした（改訂前は distance 9 / height 3.2）。
    // 引きが強すぎてキャラクタと仕掛けの造形が読めなかったため、
    // 見下ろす角度は保ったまま、距離と高さを同じ比で詰めている。
    //
    // BR-04 でさらに 1.5 で割った（4.5 → 3）。画角は 55° 固定（`render/camera.ts`）で
    // **大きさは距離だけで決まる**ので、これでキャラクタが 1.5 倍の大きさで映る。
    // `height` は見下ろし角 3.2 / 9 を保つ値（3 × 3.2 / 9 ≒ 1.0667）で、
    // 角度そのものは T2-08 の判断を動かさない。
    // `lookAhead` は `distance` 未満を保つ（背後視点は第4世代だけの署名）
    camera: { forward: LOOK_SIDE_ON, distance: 3, height: 1.0667, targetHeight: 0.3, lookAhead: 0.8 },
    audio: { channels: 24, synth: 'adpcm', sampleRate: 44100, reverb: true, positional: true },
    input: {
      directional: 'analog',
      allowDiagonal: true,
      buttons: ['jump', 'action', 'subAction'],
      analogAxes: 2,
      pressureSensitive: false,
      rumble: true,
    },
    action: {
      moveSnap: 0,
      moveSpeed: 5.5,
      variableJump: true,
      wallJump: true,
      attack: 'omni',
      fineControl: true,
    },
    player: {
      kind: 'model',
      file: 'gen3_character.glb',
      front: '+Z',
      clips: {
        idle: { animation: 'Idle_4', freeze: false },
        walk: { animation: 'Walking', freeze: false },
        jump: { animation: '360_Power_Spin_Jump', freeze: false },
      },
    },
    // 色の乏しい昼と、遠くの霧（KV-06 / SG-03）。奥へ行くほど背景色へ抜ける。
    // **空は 1 色**にする。この世代の姿は「色が乏しいこと」で、縦のグラデーションは
    // 色数の制限を持たない第2世代の署名だから。空の色は「最遠のメサ」＝
    // 遠いものが溶けていく先そのものなので、霧の色と空の色が一致する。
    // 遠景は稜線 1 枚だけで、近景を持たない（多重スクロールは第2世代の署名）
    art: {
      textureSet: 'gen3',
      backdrop: {
        sky: [KEY_COLORS.mesaFar, KEY_COLORS.mesaFar],
        // 縦のパララックスは 2D 世代の署名なので、3D の 2 世代は持たない（scrollY = 0）
        // repeat / scroll は SG-01 の 256 幅化に合わせて半分にした（判断 H）
        far: { texture: 'backdrop_far.png', repeat: 0.75, scroll: 0.003, scrollY: 0, bottom: 0.26, height: 0.3 },
        near: null,
      },
      fogDensity: 0.035,
    },
  },
  PS2: {
    id: 'PS2',
    video: {
      internalWidth: 640,
      internalHeight: 448,
      projection: 'perspective3d',
      signal: 'component',
      paletteMode: 'truecolor',
      maxSimultaneousColors: -1,
      paletteBlockSize: 0,
      spritesPerScanline: -1,
      tileSnap: 0,
      alphaBlend: true,
      affinePlane: false,
      depthBuffer: true,
      affineTexture: false,
      vertexQuantize: 0,
      dynamicLight: true,
      textureFilter: 'linear',
      animationHz: 60,
    },
    // 第4世代だけが背後視点（T2-08）。プレイヤーの背中側に立ち、
    // 進行方向のずっと先を見ることで「奥へ進んでいく」画にする。
    // 深度バッファと動的ライティングを持つ世代なので、
    // 奥行きが重なる構図に耐えられる（第3世代でこれをやると描画順が破綻する）
    camera: { forward: LOOK_ALONG_CORRIDOR, distance: 4, height: 1, targetHeight: 0.6, lookAhead: 5 },
    audio: { channels: 48, synth: 'streaming', sampleRate: 48000, reverb: true, positional: true },
    input: {
      directional: 'analog',
      allowDiagonal: true,
      buttons: ['jump', 'action', 'subAction'],
      analogAxes: 4,
      pressureSensitive: true,
      rumble: true,
    },
    action: {
      moveSnap: 0,
      moveSpeed: 5.5,
      variableJump: true,
      wallJump: true,
      attack: 'omni_lock',
      fineControl: true,
    },
    player: {
      kind: 'model',
      file: 'gen4_character.glb',
      front: '+Z',
      // このアセットは待機のクリップを持たない。歩行の 1 コマ目で止めて立ちポーズにする
      clips: {
        idle: { animation: 'Walking', freeze: true },
        walk: { animation: 'Walking', freeze: false },
        jump: { animation: '360_Power_Spin_Jump', freeze: false },
      },
    },
    // 基準画そのままの昼（KV-07 / SG-03）。**この世代だけが実測値を丸めずに出せる。**
    // 第3世代と並べたときの差は、暗さではなく**落ち影**が作る（SG-09）。
    // 動的ライトを持つのはこの世代だけで、太陽の高さが影の向きで読める
    art: {
      textureSet: 'gen4',
      backdrop: {
        sky: [KEY_COLORS.skyDay, KEY_COLORS.skyHorizon],
        // repeat / scroll は SG-01 の 256 幅化に合わせて半分にした（判断 H）
        far: { texture: 'backdrop_far.png', repeat: 1.25, scroll: 0.004, scrollY: 0, bottom: 0.14, height: 0.44 },
        near: null,
      },
      fogDensity: 0,
    },
  },
};
