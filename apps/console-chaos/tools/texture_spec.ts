/**
 * テクスチャの発注仕様（PHASE1_FEEDBACK_PLAN §9.2 の表をそのままデータにしたもの、T1-21）。
 *
 * 生成（`make-textures.ts`）と検査（`check-textures.ts`）が
 * **同じ 1 つの表**を見る。仕様と実物がずれたら CI が落ちる。
 *
 * §9.1 の共通制約:
 *   - PNG / 2 の冪 / 上限 256
 *   - 陰影を焼き込まない（陰影はシェーダが世代ごとに付ける）
 *   - 直線・規則的な構造を持たせる（第3世代のアフィン歪みは直線が曲がって初めて見える）
 *   - 色数は 8〜12 色程度、淡い色（低彩度・高明度）は使わない
 *   - 文字・記号・ロゴは入れない（`npm run check:trademark`）
 */

export interface TextureSpec {
  /** `public/assets/textures/<セット>/` 以下のファイル名 */
  file: string;
  width: number;
  height: number;
  /** 上下左右がシームレスに繋がること（タイル状に敷き詰めるもの） */
  seamless: boolean;
  /** 透過を持つこと */
  alpha: boolean;
  /** 用途 */
  use: string;
  /** 発注の主旨（§9.2）。作り直しが必要になったとき、同じ意図から出発できるように残す */
  order: string;
  /** 直線の制約を免除するか（§9.2 の #10 のみ） */
  allowBlurred?: boolean;
  /** 左右だけが繋がること（背景の層は横へ流すが、縦は帯に 1 枚を収める。KV-03） */
  seamlessX?: boolean;
  /**
   * 上下だけが繋がること（滝。UV を縦へ送り続けるので、縦だけ巻き戻せればよい。SG-01）。
   * `seamlessX` の対で、両方立てるくらいなら `seamless` を使う
   */
  seamlessY?: boolean;
  /**
   * 色数の上限の上書き（既定は `MAX_COLORS`）。
   *
   * **背景の 2 枚だけ緩める**（上位計画 §5.2）。遠景は 1 枚で地平から空までを担うので、
   * 他の絵と同じ 12 色では段丘が段に割れない。
   * `unlit` には紐づけない。`gate_glow` も陰影を受けない絵だが、色数を緩める理由は無い
   */
  maxColors?: number;
  /**
   * 貼るときに上下が入れ替わる絵か（**交差する 2 枚の板に貼るものだけ真**。SG-06）。
   *
   * 絵は 4 セットとも「見えるとおり」に描いてある（木は上が葉、下が幹）。
   * 上下が変わるのは貼り先の都合である。
   *   - 背景の層 … `backdrop.frag.glsl` は画面の上が v=1。GL の `flipY` と噛み合って上下そのまま
   *   - 箱の面 … 敷き詰める絵なので上下に意味が無い
   *   - **`props_vine`（交差する 2 枚の板）… v = 0 が板の上端**。ここだけ絵が裏返る
   *
   * `import-textures.ts` は取り込みで上下を入れ替え、
   * 絵の中身を読む検査（KV-09 の紋）は**行を逆から読む**。
   * つまり PNG の中の並びは「画面の下から上」になっている
   */
  flip?: boolean;
  /**
   * 陰影を受けない絵か（背景の層。KV-03）。
   *
   * 第1世代の量子化検査（`QUANTIZE_LEVELS` の 5 段）は「明るさを掛けてから 54 色へ落とす」
   * ことを前提にしている。背景は平らな 1 枚として陰影抜きで描かれるので、
   * この前提が当てはまらない。**掛からない検査を掛けると、白と生成りが使えなくなる**（KV-01 §2）
   */
  unlit?: boolean;
}

/**
 * テクスチャセット（KV-03、計画 §3 の決定 3）。
 *
 * **色は乗算ではなくセットの差し替えで出す。** 材質表（`src/render/material.ts`）が
 * 明文化している「色はテクスチャ側の真実。`color` は [1,1,1,1] のまま」を崩さないため。
 * 乗算で色を変えると、下の `familyIssue` が保証している
 * 「第1世代の量子化で中間灰に落ちない」が崩れる。
 *
 * `dir` は `src/generation/profiles.ts` の `art.textureSet` と一致していること
 *（`check-textures.ts` が突き合わせる）。
 */
export interface TextureSet {
  /** `public/assets/textures/<dir>/` */
  dir: string;
  /**
   * 固定 54 色へ量子化されるセットか（第1世代のみ）。
   *
   * 真のセットにだけ掛ける検査が 3 つある。
   *   1. すべての色が `FC_PALETTE` の宣言どおりの番号へ落ちる
   *   2. 陰影の 5 段で色の系統が変わらない（`familyIssue`）
   *   3. F-1 のツタ 2 本が同じ 1 色に潰れる
   * 偽のセットでは 3 の逆（2 本が別の色として読める）を課す
   */
  fixedPalette: boolean;
}

export const TEXTURE_SETS: readonly TextureSet[] = [
  { dir: 'gen1', fixedPalette: true },
  { dir: 'gen2', fixedPalette: false },
  { dir: 'gen3', fixedPalette: false },
  { dir: 'gen4', fixedPalette: false },
];

export const TEXTURE_SPECS: readonly TextureSpec[] = [
  {
    file: 'stone_floor.png',
    width: 128,
    height: 128,
    seamless: true,
    alpha: false,
    use: '床・足場（最も面積が広い）',
    order: '古い石畳。正方形の石が格子状に並び、目地が直線で縦横に走る。石ごとに明度の差。平坦な塗り',
  },
  {
    file: 'stone_wall.png',
    width: 128,
    height: 128,
    seamless: true,
    alpha: false,
    use: '壁・背景',
    order: '横長の石を積んだ壁。水平の目地が通る。床より 1 段暗い明度。平坦な塗り',
  },
  {
    file: 'metal_grate.png',
    width: 128,
    height: 128,
    seamless: true,
    alpha: false,
    use: '仕掛け・装置・橋',
    order: '金属の格子板。規則的な四角い穴が等間隔に開き、縁にリベット。冷たい青灰色。穴の内側は明確に暗い',
  },
  {
    file: 'shell_plate.png',
    width: 128,
    height: 128,
    seamless: true,
    alpha: false,
    use: 'P1-2 の殻',
    order:
      '継ぎ目で分割された金属装甲板。板の境界線がはっきり通り、境界に沿ってリベットが並ぶ。くすんだ緑がかった金属。どこが継ぎ目か一目で分かること',
  },
  {
    // F-1 のツタは**綱として横に架かる**（`material.ts` の `vine`）。
    // 原画は縦に伸びる蔓なので、取り込みで 90° 回して 128×64 にする（`ImportSpec.rope`）
    file: 'vine_green.png',
    width: 128,
    height: 64,
    seamless: false,
    alpha: true,
    use: 'F-1 のツタ A（谷に架かる綱）',
    order: '縦に伸びる太い蔓。濃い緑（彩度高め・中明度）。葉は大きな塊で 3〜4 枚。背景は透明',
  },
  {
    file: 'vine_yellow.png',
    width: 128,
    height: 64,
    seamless: false,
    alpha: true,
    use: 'F-1 のツタ B（谷に架かる綱）',
    order: 'vine_green と同じ形状・同じ配置で、色だけ黄緑。背景は透明',
  },
  {
    file: 'pedestal_top.png',
    width: 64,
    height: 64,
    seamless: false,
    alpha: false,
    use: '台座（目標）・P1-2 の核',
    order: '円形の刻印が入った石の天面。中心から放射状の溝。明るい暖色の縁取りで「触れる対象」だと分かること',
  },
  {
    file: 'mark_glyph.png',
    width: 64,
    height: 64,
    seamless: false,
    alpha: false,
    use: 'P2-1 の刻印',
    order: '床に彫られた幾何学的な刻印。同心円と直線のみ。周囲の床より暗い（影と紛れない明度差が要る）',
  },
  {
    file: 'enemy_body.png',
    flip: true,
    width: 64,
    height: 64,
    seamless: false,
    alpha: true,
    use: '敵（F-2 で 10 体並ぶ）',
    order: '単純な生き物の正面。大きな目 2 つが最大の特徴。輪郭は明確。16 画素まで縮んでも目の位置が分かること',
  },
  {
    // SG-01：原画 1024×512 を 4 分の 1 にした 256×128。128 幅では段丘の段が潰れる
    file: 'backdrop_far.png',
    width: 256,
    height: 128,
    seamless: false,
    seamlessX: true,
    unlit: true,
    alpha: true,
    maxColors: 24,
    use: '背景の遠景の層（KV-02 の `BackdropProfile.far`）',
    order: '層状の段丘（メサ）が地平に並ぶ。上端は透明で空が抜ける。遠いほど空色へ溶ける。横に繰り返して繋がること',
  },
  {
    file: 'backdrop_near.png',
    width: 256,
    height: 128,
    seamless: false,
    seamlessX: true,
    unlit: true,
    alpha: true,
    maxColors: 24,
    use: '背景の近景の層（KV-02 の `BackdropProfile.near`）。多重スクロールを持つ世代だけが使う',
    order: '水平にたなびく雲の帯が 2 段。上下は透明。輪郭は角張らせる（にじませない）。横に繰り返して繋がること',
  },
  // --- SG-01 で足した 6 枚（ステージの基準画が要求する要素。上位計画 §1 の C・E・F・I） ---
  {
    file: 'grass_top.png',
    width: 128,
    height: 128,
    seamless: true,
    alpha: false,
    use: '足場の天面（SG-04）。側面の `stone_wall.png` と対になる',
    order: '短い草が一面に生えた地面。黄緑。粗密の差で面が読める。上下左右に繰り返して繋がること',
  },
  {
    file: 'tree_pine.png',
    flip: true,
    width: 128,
    height: 128,
    seamless: false,
    alpha: true,
    use: '針葉樹（SG-06）。交差する 2 枚の板に貼る',
    order: '円錐形の針葉樹 1 本。深い緑の塊が 3 段。幹は細く短い。背景は透明。16 画素でもシルエットが読めること',
  },
  {
    file: 'foliage_tuft.png',
    flip: true,
    width: 64,
    height: 64,
    seamless: false,
    alpha: true,
    use: '低い茂み・草の房・小花（SG-06）',
    order: '低く広がった草の房。数枚の葉と、明るい小花が数点。背景は透明',
  },
  {
    file: 'cloud_bank.png',
    flip: true,
    width: 128,
    height: 128,
    seamless: false,
    alpha: true,
    unlit: true,
    use: '足元を埋める雲海（SG-07）',
    order: '水平に伸びる雲の塊。上面は明るく、下面は空色に沈む。輪郭は角張らせる。背景は透明',
  },
  {
    // W-1：64×128 では 1 行あたりの色の切り替わりが多すぎて、同色連続長の下限 4 を割る。
    // 帯の本数を減らす（＝原画の描き直し）より、寸法を 1 段上げるほうが安い
    file: 'water_fall.png',
    flip: true,
    width: 128,
    height: 256,
    seamless: false,
    seamlessY: true,
    alpha: true,
    // 雲と滝は**光そのもの**を描いた絵で、第1世代では白（背景専用の色）に落ちる。
    // 陰影の 5 段を掛ける前提が当てはまらないのは背景の層と同じ事情である
    unlit: true,
    use: '島の縁から落ちる滝（SG-08）。UV を縦へ送り続ける',
    order: '縦に落ちる水の帯が 3〜4 本。明暗の縞が縦に走る。上下の端が繋がること。背景は透明',
  },
  {
    file: 'gate_glow.png',
    flip: true,
    width: 64,
    height: 64,
    seamless: false,
    alpha: false,
    unlit: true,
    use: '門の中央で光る面（SG-10）。画面でいちばん明るい',
    order: '中心が白く飛び、外へ向かって空色へ落ちる縦長のアーチ。段は角張らせる。中心に紋（ハート）を 1 つ',
  },
];

/**
 * 画面上で隣り合う組。第1世代の量子化を通した後も明度差が残っていること（§9.3）。
 * 色相だけの差では第1世代で見分けがつかなくなる（T1-08 §4 の実測）。
 */
export const ADJACENT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // 足場の天面（草）と、その上に敷かれる道（石畳）・側面（砂岩）。SG-04 で必ず隣り合う
  ['grass_top.png', 'stone_floor.png'],
  ['grass_top.png', 'stone_wall.png'],
  ['stone_floor.png', 'stone_wall.png'],
  ['stone_floor.png', 'metal_grate.png'],
  ['stone_floor.png', 'enemy_body.png'],
  ['stone_floor.png', 'mark_glyph.png'],
  ['stone_floor.png', 'pedestal_top.png'],
  ['shell_plate.png', 'pedestal_top.png'],
];

/** 隣り合う組に要求する、第1世代の量子化後の明度差（0..255） */
export const MIN_LUMA_DELTA = 20;

/** 色数の上限（§9.1「8〜12 色程度に抑える」）。輪郭の 1 色ぶん余裕を見る */
export const MAX_COLORS = 12;

/**
 * 第1世代の量子化を通す明度（§9.3）。
 *
 * 計画は 1.0 / 0.7 / 0.4 の 3 点だったが、`ps1_forward.glsl` の陰影は
 * `0.45 + 0.55 * lambert` なので **0.45 が実際の下限**で、0.4 はどの面にも現れない。
 * 下限を 0.45 に直したうえで、間を落とさないよう 5 点に増やしてある。
 */
export const QUANTIZE_LEVELS: readonly number[] = [1.0, 0.85, 0.7, 0.55, 0.45];

/**
 * F-1 の組。形状が完全に一致していること（第1世代で同じ 1 色に潰れたとき、
 * 「同じもの 2 本」に見える必要がある）。
 */
export const VINE_PAIR: readonly [string, string] = ['vine_green.png', 'vine_yellow.png'];
