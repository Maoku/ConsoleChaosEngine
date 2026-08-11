/**
 * 材質表（PHASE1_FEEDBACK_PLAN T1-21 / T1-23）。
 *
 * **汎用のマテリアル体系は作らない**（GAME_PLAN §11.1.1）。ここが持つのは
 * 「世代差を画面に出すために要る項目」だけの薄い表である。
 * シェーダグラフも、材質の継承も、実行時の合成も持たない。
 *
 * レベルデータは色も見た目も持たない（3D の真実だけを持つ。§5.9）方針は維持する。
 * **要素種別 → 見た目**の対応はこのファイルが唯一持つ。
 *
 * 色は**テクスチャ側の真実**とし、`color` は原則 [1,1,1,1] のままにする。
 * 掛け算で色を変えると、`tools/check-textures.ts` が保証している
 * 「第1世代の量子化で中間灰に落ちない」が崩れるため（T1-08 §4）。
 */

/** 5 群。一目で区別できることが T1-23 の受け入れ条件 */
export type MaterialRole = 'background' | 'platform' | 'gimmick' | 'enemy' | 'goal';

export interface Material {
  role: MaterialRole;
  /** テクスチャに掛ける係数。陰影は焼き込まず、世代ごとにシェーダが付ける */
  color: readonly [number, number, number, number];
  /** `public/assets/textures/` 以下のファイル名 */
  texture: string;
  /**
   * 天面（上を向いた面）だけに貼る 2 枚目の絵。null なら 6 面とも `texture`（SG-04）。
   *
   * 基準画の足場は**天面が草・側面が砂岩**で、1 枚のテクスチャでは出せない
   *（上位計画 §1 の C）。`ps1_forward.glsl` が法線の Y で切り替える。
   *
   * **ドローコールは増えない。** 2 枚目のサンプラを増やすだけで、
   * 持たない材質には 1 枚目と同じ絵を束ねる（束ねないと GL がユニット 0 の残りを拾う）
   */
  topTexture: string | null;
  /**
   * ワールド 1 単位あたりのテクスチャの繰り返し数。
   * 0 は「面いっぱいに 1 枚貼る」（プロップ用）。
   *
   * 0.5 は「1 タイル = 2 ワールド単位」。テクスチャ 1 枚に石が 4 つ並ぶので、
   * 石 1 つが 0.5 単位 = 第1世代の 16 画素 = カラークラッシュのブロックと一致する。
   */
  uvScale: number;
  /** `public/assets/models/` のプロップ名（拡張子なし）。null なら分割つきの箱で描く */
  model: string | null;
  /**
   * アルファ抜きのしきい値。0 で無効。
   * 交差する 2 枚の板で草木やスプライトを作るときに使う（実機と同じ作り方）。
   * 半透明合成を持たない第1世代でも成立する
   */
  alphaCutoff: number;
  /** 半透明で描く（S-1）。加算合成を持たない世代では**描かれない** */
  translucent: boolean;
  /** 落ち影を作る（P2-1 の柱）。動的ライトを持つ世代でのみ効く */
  castShadow: boolean;
  /**
   * 環境光と拡散光の取り分（T2-04）。合計が明るさの上限になる。
   *
   * 既定の 0.45 / 0.55 は改訂前にシェーダへ直に書かれていた値で、見た目は変わらない。
   * **暗室（P2-1）だけが 0.05 / 0（`dark()`）**で、松明の光しか届かない。
   */
  ambient: number;
  diffuse: number;
  /**
   * 空の見えない部屋の材質か（BR-03）。
   *
   * **暗さの正本を増やさないための旗である。** `dark()` が作る材質は
   * 「松明の光しか届かない」を意味していたが、KV-02 で背景が全画面 1 枚になってから、
   * ほぼ黒の床が**空を背にしたシルエット**として読めるようになってしまった。
   *
   * 暗室かどうかは**場所**の話であって世代の話ではない（不変条件 I2）ので、
   * `gameplay/scene.ts` はこの旗を持つ材質を含むセクタを暗室と見なし、
   * そこにいる間だけ背景と霧を落とす。レベルスキーマには足さない（§5.9）。
   */
  interior: boolean;
  /** 三角形単位のソートを掛ける（P1-2）。深度バッファを持たない世代でのみ効く */
  polygonSort: boolean;
  /**
   * 当たり判定だけを持ち、描かない。
   * 見た目を別の 1 つのモデルがまとめて受け持つ場合に使う（P1-2 の殻）
   */
  collisionOnly: boolean;
  /**
   * 装飾か（SG-05、上位計画 §3 の決定 2）。
   *
   * **装飾とは `collider` を持たない要素である。** 物理にも投影にもパズルにも現れない
   *（`session.bodies()` は `collidersOf` から作られる）ので、
   * `requiredGenerations` と `solvableIn` は機械的に変わりようがない。
   *
   * 旗をここに置くのは、レベルデータに見た目を持たせない方針（§5.9）を保つため。
   * `tools/check-levels.ts` が**この旗と「`collider` を持たないこと」が同値であること**を
   * 毎回見る。同値にすることで「装飾に当たり判定が生えた」と
   * 「当たり判定を持つものに装飾の材質が付いた」の両方が 1 つの検査で落ちる
   */
  decoration: boolean;
  /**
   * 上下に揺れる振幅（m。0 は動かない。SG-07）。
   *
   * **位相は要素の位置から作る**ので、同じ入力から同じ動きが出る（不変条件 I4）。
   * `gameplay/` はこれを知らない（`frame.positions` は書き換えられない）。
   * 動く量には `Renderer3dOptions.motionAmount()` が掛かる（光過敏への配慮。判断 I）
   */
  float: number;
  /**
   * 1 秒あたりに送る UV の縦成分（0 は送らない。SG-08）。
   *
   * 頂点シェーダで UV へ加える。**フラグメント側でずらすとアフィン補間の前後がずれる**
   *（第3世代の歪みは UV の補間そのものなので、後からずらすと歪みが動いてしまう）。
   * `motionAmount()` が掛かるのは `float` と同じ
   */
  uvScrollY: number;
  /**
   * 通り抜けられる間は描かない。
   * **原則 false。**「消える」は理由を伝えないので、見え方の変化で表すのが方針（§3-4）。
   * 架かる橋のように「現れること自体が意味を持つ」ものだけ true にする。
   */
  hideWhenPassable: boolean;
}

const OPAQUE: readonly [number, number, number, number] = [1, 1, 1, 1];

/** 陰影の既定。改訂前にシェーダへ直に書かれていた値と同じ（見た目を変えないため） */
export const DEFAULT_AMBIENT = 0.45;
export const DEFAULT_DIFFUSE = 0.55;

/** 敷き詰める面の既定値（床・壁） */
function surface(role: MaterialRole, texture: string): Material {
  return {
    role,
    color: OPAQUE,
    texture,
    topTexture: null,
    uvScale: 0.5,
    model: null,
    alphaCutoff: 0,
    translucent: false,
    castShadow: false,
    ambient: DEFAULT_AMBIENT,
    diffuse: DEFAULT_DIFFUSE,
    interior: false,
    polygonSort: false,
    collisionOnly: false,
    decoration: false,
    float: 0,
    uvScrollY: 0,
    hideWhenPassable: false,
  };
}

/** プロップの既定値（面いっぱいに 1 枚貼る） */
function prop(role: MaterialRole, texture: string, model: string | null): Material {
  return {
    role,
    color: OPAQUE,
    texture,
    topTexture: null,
    uvScale: 0,
    model,
    alphaCutoff: 0,
    translucent: false,
    castShadow: false,
    ambient: DEFAULT_AMBIENT,
    diffuse: DEFAULT_DIFFUSE,
    interior: false,
    polygonSort: false,
    collisionOnly: false,
    decoration: false,
    float: 0,
    uvScrollY: 0,
    hideWhenPassable: false,
  };
}

/**
 * 草木の既定値（SG-06）。**装飾なので当たり判定を持たない**（上位計画 §3 の決定 2）。
 *
 * 交差する 2 枚の板に絵を貼り、アルファで抜く。実機の草木と同じ作り方で、
 * 半透明合成を持たない第1世代でも成立する。
 */
function flora(texture: string): Material {
  return { ...prop('background', texture, 'props_vine'), alphaCutoff: 0.5, decoration: true };
}

/**
 * 目標の門（SG-10）。**光そのものなので陰影を受けない。**
 *
 * 絵は 1 枚しか貼れないので、石塔とアーチの塗り分けはモデル側の UV が持つ
 *（`tools/blender_export_props.py` の `build_gate`）。
 */
function gate(): Material {
  return { ...prop('goal', 'gate_glow.png', 'props_gate'), ambient: 1, diffuse: 0 };
}

/** 天面に草を生やす（SG-04）。側面は引数の材質のまま */
function grassTopped<T extends Material>(material: T): T {
  return { ...material, topTexture: 'grass_top.png' };
}

/**
 * 暗室の材質（P2-1、T2-04）。**環境光をほぼ 0 にし、平行光も受けない。**
 * 松明（点光源）の届く範囲だけが見える状態を作る。
 *
 * BR-03 で `interior` も同時に立てるようにした。**暗室の宣言はこの 1 か所だけ**にする、
 * という T2-04 の形をそのまま保つためで、`tests/unit/scene.test.ts` が機械的に見る。
 */
function dark<T extends Material>(material: T): T {
  return { ...material, ambient: 0.05, diffuse: 0, interior: true };
}

/**
 * レベル要素の種別 → 見た目。**area1 が使う種別すべてを定義する。**
 *
 * 改訂前は 4 種だけが色を持ち、残り 10 種が既定の灰色だった。
 * 「どれが足場でどれが仕掛けか分からない」（所見 2）の直接の原因はここにあった。
 */
export const MATERIALS: Record<string, Material> = {
  // --- 足場 ---
  // 天面は草、側面は砂岩のブロック（SG-04、上位計画 §1 の C）。
  // **空の見えない部屋（`causeway`）には草を生やさない**ので、そちらは触らない
  platform: grassTopped(surface('platform', 'stone_wall.png')),
  bridge_far: grassTopped(surface('platform', 'stone_wall.png')),
  // 公転する島（S-1）。回る面に固定されているので、面と一緒に動く
  island: grassTopped(surface('platform', 'stone_wall.png')),
  // 回る面そのもの（S-1）。画面いっぱいに広がる背景の床で、当たり判定は持たない
  affine_floor: { ...surface('background', 'stone_floor.png'), uvScale: 0.25 },
  // --- 背景 ---
  wall: surface('background', 'stone_wall.png'),
  // --- 仕掛け ---
  // 谷に架かる 2 本のツタ（F-1）。実体はそのままに、**綱として横に架かる**ので敷き詰める面で描く。
  // 色の違いは ENTITY_MATERIALS が持つ（CH 1 で同一色に潰れることが成立条件）。
  // 絵の 86% は透明なので、抜きを掛けないと空が黒く塗り潰される（SG-03 で空が昼になって露見した）
  vine: { ...surface('gimmick', 'vine_green.png'), uvScale: 1, alphaCutoff: 0.5, hideWhenPassable: true },
  // 撚り合わさった 1 本（F-1）。色が潰れている間だけ現れる（現れること自体が答え）
  braid: { ...surface('gimmick', 'vine_green.png'), uvScale: 1, alphaCutoff: 0.5, hideWhenPassable: true },
  // 谷の踏み石（F-2）。偽物は触れた瞬間に崩れて消える
  tile: { ...surface('gimmick', 'metal_grate.png'), hideWhenPassable: true },
  // 本物の石を指す灯（F-2）。常に灯っているが、光の幕に隠れて見えない
  lamp: prop('gimmick', 'mark_glyph.png', 'props_mark'),
  // 半透明の踏み台。加算合成を持つ世代でだけ見え、そのときだけ乗れる
  translucent: { ...surface('gimmick', 'metal_grate.png'), color: [1, 1, 1, 0.55], translucent: true },
  // 殻。**第3世代でも消さない**。食い込んだ板を三角形単位でソートすると継ぎ目が裂ける（T1-27）
  shell: { ...prop('gimmick', 'shell_plate.png', 'props_shell'), polygonSort: true },
  // 殻の当たり判定だけを持つ板。見た目は殻のモデル 1 つが受け持つので描かない。
  // §3-4 の「消えるで表現しない」とは別の話で、これらは最初から見た目を持たない
  shell_wall: { ...surface('gimmick', 'shell_plate.png'), collisionOnly: true },
  shell_seam: { ...surface('gimmick', 'shell_plate.png'), collisionOnly: true },
  switch: prop('gimmick', 'metal_grate.png', 'props_switch'),
  // --- 暗室（P2-1）。松明の光しか届かない ---
  causeway: dark(surface('platform', 'stone_floor.png')),
  // 柱。松明が動くと影が扇のように振れる（T2-05）。影が動くことで奥行きが読める
  pillar: dark({ ...surface('background', 'stone_wall.png'), castShadow: true }),
  mark: dark(prop('gimmick', 'mark_glyph.png', 'props_mark')),
  // 草の上に敷かれた砂色の石畳（判断 F、上位計画 §1 の D）。**当たり判定は持たない。**
  // 足場の天面（y = 0）に中心を合わせた薄い板なので、上面だけが 0.02m 高いところに出る。
  // 深度を持たない世代でも、板の中心が床の中心よりカメラ側に来るので描画順は必ず正しくなる
  //（`collect()` は中心の距離で並べる）
  path: { ...surface('background', 'stone_floor.png'), decoration: true },
  // --- 装飾（SG-06）。**当たり判定を持たない**ので、置いてもパズルは変わらない ---
  // どれも交差する 2 枚の板（`props_vine`・8 三角形）に絵を貼るだけ。
  // 実機の草木と同じ作り方で、半透明合成を持たない世代でも抜きで成立する
  tree: flora('tree_pine.png'),
  bush: flora('foliage_tuft.png'),
  // 房は茂みと同じ絵で、レベル側が `transform.scale` を小さく取る（絵を増やさない）
  flower: flora('foliage_tuft.png'),
  // 足元を埋める雲海（SG-07）。回廊が空に浮いていることを、雲の上に立つことで示す
  cloud: flora('cloud_bank.png'),
  // 空に散る立方体（SG-07）。**足場と同じ材質でできている**（基準画のとおり）。
  // 語彙を増やさない：新しい絵も新しいモデルも足さず、足場の材質へ decoration を立てるだけ
  sky_cube: { ...grassTopped(surface('background', 'stone_wall.png')), decoration: true, float: 0.5 },
  // 島の縁から落ちる滝（SG-08）。**加算合成を持たない第1世代でも抜きで成立する**ので
  // `translucent` は立てない。落ち続けて見えるのは UV を縦へ送っているからだけである
  waterfall: { ...flora('water_fall.png'), uvScrollY: 0.35 },
  // --- 敵 ---
  enemy: { ...prop('enemy', 'enemy_body.png', 'props_enemy'), alphaCutoff: 0.5 },
  // 谷にたかる同じ生き物の群れ（F-2）。**スプライトなので走査線の上限に掛かる**。
  // あふれた分が表示されず、群れが裂けて奥の灯が覗く
  swarm: { ...prop('enemy', 'enemy_body.png', 'props_enemy'), alphaCutoff: 0.5 },
  // --- 目標 ---
  // 段積みの石塔の中央に、白く光る縦長のアーチ（SG-10、上位計画 §1 の I）。
  // **門そのものが光なので陰影を受けない**（`ambient: 1` / `diffuse: 0`）。
  // 受けると中心の白が陰影の 5 段で沈み、「画面でいちばん明るいもの」でなくなる
  pedestal: gate(),
  goal: gate(),
  // 核は八面体。殻の裂け目から覗いたときに、台座と同じ「目標の色」で読める
  core: prop('goal', 'pedestal_top.png', 'props_caster'),
};

/**
 * 要素 id ごとの上書き。
 *
 * **F-1 のツタ 2 本のためだけにある。** 2 本は世界の中では別の材質であり、
 * レベルデータに色を持たせない方針（§5.9）を保つと、対応づけの置き場はここしか無い。
 * 「CH 2 以降では明確に別の緑・CH 1 では完全に同一色」は
 * テクスチャ側で保証してある（`tools/check-textures.ts` の F-1 検査）。
 */
export const ENTITY_MATERIALS: Record<string, Partial<Material>> = {
  f1_vine_a: { texture: 'vine_green.png' },
  f1_vine_b: { texture: 'vine_yellow.png' },
};

/** 未知の種別に使う。CI（`check-levels`）が拾えるよう、意図的に目立つ見た目にする */
export const FALLBACK_MATERIAL: Material = prop('background', 'metal_grate.png', null);

export function materialFor(type: string, entityId?: string): Material {
  const base = MATERIALS[type] ?? FALLBACK_MATERIAL;
  const override = entityId === undefined ? undefined : ENTITY_MATERIALS[entityId];
  return override ? { ...base, ...override } : base;
}

/** 読み込むべきテクスチャの一覧（重複なし・定義順）。描画側が起動時にまとめて読む */
export function requiredTextures(): string[] {
  const files = new Set<string>();
  for (const material of Object.values(MATERIALS)) {
    files.add(material.texture);
    if (material.topTexture) files.add(material.topTexture);
  }
  for (const override of Object.values(ENTITY_MATERIALS)) {
    if (override.texture) files.add(override.texture);
  }
  files.add(FALLBACK_MATERIAL.texture);
  return [...files];
}

/** 使うプロップモデルの一覧（重複なし・定義順） */
export function requiredModels(): string[] {
  const models = new Set<string>();
  for (const material of Object.values(MATERIALS)) {
    if (material.model) models.add(material.model);
  }
  return [...models];
}
