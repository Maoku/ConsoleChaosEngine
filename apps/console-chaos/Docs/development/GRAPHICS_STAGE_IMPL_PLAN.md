# 試作ステージ グラフィックス実装計画（SG-01〜SG-11 の手順）

上位計画: [GRAPHICS_STAGE_PLAN.md](GRAPHICS_STAGE_PLAN.md)（**何を作るか**。決定 1〜8、タスク SG-01〜SG-11）
発注仕様: [ASSET_REQUEST_STAGE.md](ASSET_REQUEST_STAGE.md)（**何を頼んだか**。A-01〜A-13）
基準画: [concept/stage-02-emerald-sky-gen-04.png](../concept/stage-02-emerald-sky-gen-04.png)

本書が持つのは**どう作るか**である。触るファイル・手順・受け入れの測り方・順番だけを書き、
「なぜそうするか」は上位計画へ譲る。上位計画の決定と食い違う判断をした箇所は
**§2 に理由つきで明示する**（食い違いを黙って埋めない）。

**素材は納品済み**（`Docs/concept/source/` に 14 枚）。したがって本書は
「発注中に何ができるか」を考える必要が無く、SG-01 から順に実装できる状態から始まる。
§1 はその納品物を機械的に測った結果で、**推測ではなく実測から始めるための節**である。

不変条件（上位計画から引き継ぐ。**変えない**）:

- I1: 世界の真実は 3D 1 つ。2D は投影であって別の世界ではない
- I2: ゲームロジックに世代 ID の分岐を書かない（`chaos/no-generation-branch`）
- §5.9: レベルデータは色も見た目も持たない。**種別 → 見た目**は `render/material.ts` だけが持つ
- §11.1.1: 汎用の抽象（マテリアルグラフ、レイヤシステム、テーマ機構）は作らない
- 決定 1: レベルのジオメトリ・当たり判定・パズルには手を入れない
- 決定 2: 装飾とは `collider` を持たない要素である

---

## 1. 納品素材の受け入れ計測

`tools/png.ts` で 14 枚を読み、`tools/check-textures.ts` と同じ式で測った。

### 1.1 原画そのもの

| 素材 | 寸法 | 発注寸法 | 色数 | 半透明画素 | 同色連続 | 平均明度 |
|---|---|---|---|---|---|---|
| `src_grass_top` | 512×512 | ✓ | 8 | 0 | 25.3 | 164 |
| `src_stone_floor` | 512×512 | ✓ | 6 | 0 | 43.9 | 194 |
| `src_stone_wall` | 512×512 | ✓ | 7 | 0 | 68.5 | 118 |
| `src_backdrop_far` | 1024×512 | ✓ | 10 | 0 | 58.6 | 133 |
| `src_backdrop_near` | 1024×512 | ✓ | 3 | 0 | 162.0 | 194 |
| `src_tree_pine` | 512×512 | ✓ | 3 | 0 | 133.1 | 66 |
| `src_foliage_tuft` | 256×256 | ✓ | 7 | 0 | 31.5 | 145 |
| `src_cloud_bank` | 512×512 | ✓ | 3 | 0 | 181.9 | 187 |
| `src_water_fall` | 256×512 | ✓ | 3 | 0 | 15.1 | 180 |
| `src_gate_glow` | 256×256 | ✓ | 7 | 0 | 26.5 | 152 |
| `src_vine_green` | 256×512 | ✓ | 2 | 0 | 67.2 | 81 |
| `src_vine_yellow` | 256×512 | ✓ | 2 | 0 | 67.2 | 95 |
| `src_pedestal_top` | 256×256 | ✓ | 8 | 0 | 5.8 | 194 |
| `src_enemy_body` | 256×256 | ✓ | 8 | 0 | 24.2 | 90 |

**14 枚とも発注寸法どおりで、半透明の画素が 1 つも無い**（アルファは 0 か 255 だけ）。
色数はすべて上限 12 の内側。§0.3 の制約 1〜5 は原画の時点で守られている。

- 端の繋がり: `backdrop_far` / `backdrop_near` / `grass_top` / `stone_floor` / `stone_wall` は
  巻き戻しの差が 0.0（内側の最大は 12.6〜62.2）。**発注どおりのタイル性がある**
- `vine_green` / `vine_yellow` の**アルファ不一致は 0 画素**（131,072 画素中）。F-1 の前提を原画が満たす

### 1.2 4 倍縮小したあと（＝ gen4 セットに入る絵そのもの）

縮小は**ブロック内の最頻色**（§2 の判断 B）。平均を取ると原画に無い色が生まれる。

| 素材 | 最終寸法 | 色数 | 直線構造 | 同色連続 | 明度 |
|---|---|---|---|---|---|
| `grass_top` | 128×128 | 8 | **50%** | 6.3 | 164 |
| `stone_floor` | 128×128 | 6 | **53%** | 11.1 | 194 |
| `stone_wall` | 128×128 | 7 | **61%** | 17.4 | 118 |
| `backdrop_far` | 256×128 | 9 | 46% | 26.6 | 133 |
| `backdrop_near` | 256×128 | 3 | 68% | 43.3 | 195 |
| `tree_pine` | 128×128 | 3 | 27% | 33.5 | 66 |
| `foliage_tuft` | 64×64 | 5 | 30% | 9.1 | 145 |
| `cloud_bank` | 128×128 | 3 | 53% | 46.8 | 187 |
| `water_fall` | 64×128 | 3 | 62% | **3.8** | 180 |
| `gate_glow` | 64×64 | 4 | 65% | 10.1 | 152 |
| `vine_green` / `vine_yellow` | 64×128 | 2 | 56% | 18.0 | 82 / 95 |
| `pedestal_top` | 64×64 | 7 | **0%** | 4.5 | 195 |
| `enemy_body` | 64×64 | 5 | 27% | 8.8 | 90 |

敷き詰める 5 枚（`grass_top` / `stone_floor` / `stone_wall` / 背景 2 枚）は
**直線構造の下限 30% を全部超えている**。直線の検査が掛からない絵（木・房・敵・台座）が
30% を割っているのは仕様どおりで、問題ではない。

隣り合う組の明度差（面積で重み付け、下限 20）:

| 組 | gen4 | gen2 | gen3 |
|---|---|---|---|
| `grass_top` ↔ `stone_floor` | 30.1 | 32.9 | 59.8 |
| `grass_top` ↔ `stone_wall` | 46.1 | 45.0 | 37.5 |
| `stone_floor` ↔ `stone_wall` | 76.2 | 77.9 | 97.3 |
| `stone_floor` ↔ `enemy_body` | 104.0 | 104.9 | 110.4 |

gen2 / gen3 の値は §2 の判断 C の変換規則を通したあとの実測である。

### 1.3 計測で見つかった 4 つの引っかかり

**W-1: `water_fall` の同色連続が 3.8 で、下限 4 を割る。**
64 画素幅に縦の帯を 3〜4 本入れると、1 行あたりの色の切り替わりが多くなりすぎる。
→ **最終寸法を 64×128 から 128×256 へ変える**（原画 256×512 を 2 分の 1 に縮小する。
縦横の比は発注どおりのまま）。実測で**連続長 7.5・上下の端は繋がったまま**になる。
帯の本数を減らす（＝原画の描き直し）より、寸法の変更のほうが安い。
上限 256 の内側なので `asset-rules.md` §7 にも収まる。

**W-2: `pedestal_top` と `gate_glow` に紋（ハート）が無く、KV-09 のゴールデンが落ちる。**
`tests/golden/material.test.ts` は 4 セットの `pedestal_top.png` と `mark_glyph.png` に
「上部に 2 つの山があり、下へ行くほど細くなって 1 本の先で終わる」輪郭を要求する。
納品された `src_pedestal_top`（同心円）も `src_gate_glow`（同心のアーチ）もこれを満たさない
（機械的に確認済み：両方とも「落ちる」）。
→ §2 の判断 J（`pedestal_top` は取り込まない）と SG-10（門の光にハートを 1 つ重ねる）で解く。

**W-3: `backdrop_far` の透明率が 52.5% で、「遠景を敷き詰めない」の下限 50% ぎりぎり。**
`tests/golden/backdrop.test.ts` の「遠景は敷き詰めない」は第1世代にだけ掛かるが、
gen1 の写像で稜線の一部を透明へ落とすと簡単に割れる。
→ SG-01 の gen1 写像では**アルファを一切触らない**ことを規則にする（色だけを写す）。

**W-4: 第1世代は最近傍では作れない。**
14 枚の原画に出てくる主要な色は、固定 54 色の**14 個の番号**へ散る。しかも
`(148,106,71)`（石畳の目地）、`(219,228,251)`（雲の明部）、`(120,134,170)`（奥の稜線）など
7 色が**中間灰へ落ちて形が消える**。
→ SG-01 の gen1 変換は最近傍ではなく、**「役割 → FC_PALETTE の番号」の宣言写像**にする
（§2 の判断 D に検証済みの 7 色を置いた）。上位計画 SG-01 の
「第1世代は `FC_PALETTE` の宣言どおりの番号へ落ちる」はこの意味に取る。

---

## 2. 実装の設計判断

上位計画の決定 1〜8 を、実装の粒度へ落とす。**上位計画と食い違う判断には ⚠ を付けた。**

### 判断 A: 取り込みと手続きの分担

`tools/import-textures.ts`（新規）が 13 枚、`tools/make-textures.ts`（既存）が 4 枚を出す。

| 生成元 | 枚数 | ファイル |
|---|---|---|
| 取り込み（原画あり） | 13 | `grass_top` `stone_floor` `stone_wall` `backdrop_far` `backdrop_near` `tree_pine` `foliage_tuft` `cloud_bank` `water_fall` `gate_glow` `vine_green` `vine_yellow` `enemy_body` |
| 手続き（原画なし） | 4 | `metal_grate` `shell_plate` `mark_glyph` `pedestal_top` |

合計 **17 枚 × 4 セット = 68 枚**（現在は 11 × 4 = 44 枚）。

`metal_grate` / `shell_plate` / `mark_glyph` は上位計画 §6 のとおり発注しない。
`pedestal_top` は発注したが取り込まない（判断 J）。
`make-textures.ts` は形の手続きが 11 個から 4 個へ減り、`SetColors` も
`device` / `shell` / `mark` / `goal` の 4 群だけになる。**「形の手続き 1 つ・色表 4 つ」という
KV-03 の形はそのまま残る。**

### 判断 B: 縮小は最頻色（平均を使わない）

4×4 のブロックごとに**最も多く出た RGBA をそのまま採る**。平均を取ると原画に無い中間色が
生まれ、色数の上限（12）と同色連続長（4）の両方を壊す。輪郭のアルファも 0 か 255 のまま残る。

### 判断 C: 下位 3 セットの変換規則

| セット | 規則 |
|---|---|
| gen4 | 縮小のみ。原画の色をそのまま置く（実測: 淡色 0 件・色数 ≤ 9） |
| gen2 | 明度を軸に彩度を 1.18 倍し、各チャンネルを RGB555 へ丸める（`v & 0xf8`） |
| gen3 | 同明度の灰青（`[y·0.92, y·0.97, y·1.12]`）と 6:4 で混ぜ、全体を 0.82 倍する |
| gen1 | 判断 D の宣言写像。**アルファは触らない**（W-3） |

**gen3 には後処理が 1 つ要る。** 混ぜた結果が「彩度 40 未満かつ明度 150〜200」の
禁止域（`check-textures.ts` の淡色検査）へ入る色が 4 枚ぶん出る。
このとき**明度を上げて 208 へ抜ける**（下げてはいけない）。

> 下へ抜けると `stone_floor`（砂色）が明度 148 まで落ち、`grass_top` との差が
> **8.8** になって下限 20 を割る（実測）。上へ抜ければ **59.8** で通る。
> 禁止域は「黒と白の間の無彩色」であって白は禁止ではない（`isMidGray` の上限 200 と同じ根拠）。

この規則で、F-1 のツタ 2 本の色の隔たりは gen4 50.5 / gen2 58.0 / gen3 20.6（下限 12）。

### 判断 D: 第1世代の 7 色（SG-02 の答え）

固定 54 色を総当たりして、**陰影 5 段（1.0 / 0.85 / 0.7 / 0.55 / 0.45）で中間灰へ落ちず、
色相のぶれが 45° 以内**の `source` を持つ番号を洗い出し、そこから空のテーマを組んだ。

| 用途 | key | 番号 | 画面に出る色 | 明度 | `source`（絵に置く色） | lit |
|---|---|---|---|---|---|---|
| 空 | `skyDay` | 27 | `[76,154,236]` | 140 | `[72,152,232]` | ✓ |
| 草 | `grass` | 34 | `[160,170,0]` | 148 | `[160,168,0]` | ✓ |
| 針葉樹・深い陰 | `conifer` | 22 | `[40,114,0]` | 79 | `[40,112,0]` | ✓ |
| 道の砂色 | `sand` | 46 | `[228,196,144]` | 200 | `[248,216,96]` | ✓ |
| 砂岩の側面 | `sandstone` | 20 | `[120,60,0]` | 71 | `[120,56,0]` | ✓ |
| 遠景のメサ | `mesa` | 32 | `[236,106,100]` | 144 | `[232,104,96]` | ✓ |
| 門の光 | `white` | 53 | `[255,255,255]` | 255 | `[248,248,248]` | — |

**7 色とも検証済み**：番号は互いに重ならず、`lit` の 6 色は 5 段すべてで中間灰を避け、
色相のぶれは最大 29°。`white` だけが `lit: false`（背景・陰影を受けない絵の専用）で、
**背景専用の色は増えていない**（上位計画 SG-02 の条件）。

`source` と番号を分ける理由は KV-01 と同じである。たとえば道の砂色は
**黄色 `[248,216,96]` を置くと砂色 `[228,196,144]` として出る**。置いた色がそのまま出るとは限らない。

`KEY_COLORS`（題字の基準画の実測表）へは 6 つの名前を足すだけで、既存の 12 個は**消さない**。
`pipeline.ts` の切替の帯（KV-08）が `titlePink` / `sky` / `white` を読んでいる。

### 判断 E: 装飾はスキーマを増やさない

`LevelEntity.collider` は既に任意で、`LevelTransform.scale` も既にある（`src/level/schema.ts:37,51`）。
**スキーマの変更は 0 行**で済む。足すのは次の 2 つだけ。

1. `Material.decoration: boolean`（既定 false）
2. `tools/check-levels.ts` の検査：**`materialFor(type).decoration` と「`collider` を持たない」が同値**

同値にすることで、「装飾に当たり判定が生えた」と「当たり判定を持つものに装飾の材質が付いた」の
両方が 1 つの検査で落ちる（上位計画 §5 の 2 行ぶん）。

大きさは `transform.scale`（省略時 `[1,1,1]`）を `halfExtents` の代わりに使う。
`buildDrawables` は `collidersOf(level)` ではなく全要素を回すようになり、
`FrameDrawable` に**レベルが置いた静止位置**を 1 つ足す（当たり判定を持たない要素は
`session.bodies()` に居ないので、位置の出どころがここしか無い）。

> **装飾の位置も 0.25 単位のグリッドに載せる必要がある。** `validateLevel` の
> `checkGrid` は `transform.position` を要素の区別なく見る（`schema.ts:220`）。
> `scale` にはグリッド検査が掛からないので、大きさは自由に決めてよい。

### 判断 F: 天面は 2 枚目のサンプラ

`Material.topTexture: string | null` を足し、`ps1_forward.glsl` で
`vNormal.y > 0.5` のときだけ 2 枚目を読む。`topTexture` が null の材質には
**同じ絵を 2 つ目のサンプラにも束ねる**（束ねないと GL がユニット 0 の残りを拾う。
影の板が `stone_floor.png` を通しているのと同じ扱い）。ドローコールは増えない。

⚠ **道（`stone_floor.png`）の置き場は SG-04 では決まらない。**
上位計画の決定 4 が言うのは「天面 = 草・側面 = 砂岩」で、基準画の道はその**上に敷かれている**。
道は当たり判定を持たないので装飾（決定 2）として置く：足場の天面より **+0.02m** 高い薄い箱を、
`stone_floor.png` の材質で並べる。深度を持たない世代でも、板の中心が床の中心より
カメラ側に来るので描画順は必ず正しくなる（`collect()` は中心の距離で並べる）。
これが画面で成立しない場合の退避先は「天面を石畳のままにし、草を側面と縁にだけ出す」で、
判断は SG-11（4 世代を並べる作業）で下す。

### 判断 G: 環境光は明度を変えず、色相だけを与える

`uniform float uAmbient` を `vec3` にする（上位計画の決定 7 どおり。uniform は増えない）。
渡す値は `material.ambient × tint`、`tint = 空の下端色 ÷ その明度`。

**明度で正規化するのが要点である。** これで `ambient` が持つ「陰影の取り分」の意味が変わらず、
暗室（P2-1、`ambient: 0.05`）の明るさも変わらない。変わるのは影側の色相だけになる。
背景と同じ係数（`frame.backdrop.brightness`）を掛けるので、空の見えない部屋では
環境光の色も一緒に落ちる（霧が既にそうしている。`renderer3d.ts:815`）。

落ち影の板とスプライトは `uAmbient: [1,1,1]` を渡す（絵に陰影が焼き込まれているので色を乗せない）。

### 判断 H: 背景の層が 128→256 幅になる副作用

`repeat` と `scroll` を**4 世代とも半分にする**。層が画面に占める幅と流れる速さが変わらない。

| 世代 | repeat | scroll | scrollY | bottom | height |
|---|---|---|---|---|---|
| 第1世代 far | 2 → **1** | 0.25 → **0.125** | 0.143 | 0.5 | 0.5714 |
| 第2世代 far | 2 → **1** | 0.0125 → **0.00625** | 0.007 | 0.24 | 0.34 |
| 第2世代 near | 2 → **1** | 0.1125 → **0.05625** | 0.064 | 0.5 | 0.42 |
| 第3世代 far | 1.5 → **0.75** | 0.006 → **0.003** | 0 | 0.26 | 0.3 |
| 第4世代 far | 2.5 → **1.25** | 0.008 → **0.004** | 0 | 0.14 | 0.44 |

これで既存のゴールデンが 3 つそのまま通る。
2D 世代のテクセルと画面画素が 1:1（`repeat × 幅 = internalWidth` → 1 × 256 = 256 ✓）、
第1世代が床と同速（`scroll = repeat / 8 = 0.125` ✓、`scrollY = 1 / 7` ✓）、
第2世代の 2 層の速度比 9 倍（0.05625 / 0.00625 ✓）。

### 判断 I: 動きは関数で受ける

雲の上下（SG-07）と滝の UV 送り（SG-08）は `Renderer3dOptions` に
`motionAmount?: () => number`（既定 1）を足して掛ける。`glitchAmount` と同じ形にしておけば、
T3-06 で光過敏の設定画面を作るときに 1 か所から両方へ配れる
（`src/ui/a11y.ts` は現在まだ空のファイルで、設定の本体は無い）。

### 判断 J: `pedestal_top.png` は取り込まない ⚠

納品された A-12 は同心円で、KV-09 のハートを持たない（W-2）。台座は
`make-textures.ts` の手続きのまま残す。**KV-09 の紋の語彙を守るほうを優先する。**
A-12 の原画は将来ハートを入れて描き直すときの下地として `Docs/concept/source/` に残す。

`gate_glow.png` は取り込んだうえで、**中心にハートを 1 つ重ねる**（SG-10）。
`make-textures.ts` の `heart()` を `tools/glyph_heart.ts` へ出し、2 つのツールが同じ形を使う。

---

## 3. タスクごとの手順

### SG-01 外部素材の取り込み経路

**触るもの**: `tools/import-textures.ts`（新規 ~320 行）、`tools/texture_spec.ts`、
`tools/check-textures.ts`、`tools/make-textures.ts`（11 → 4 手続きへ縮小）、
`package.json`（`import:textures` を足す）、`tools/texture_spec.ts`

**手順**

1. `texture_spec.ts` に 6 枚を足し、5 枚を直す。

   | ファイル | 寸法 | seamless | alpha | 備考 |
   |---|---|---|---|---|
   | `grass_top.png` | 128×128 | 上下左右 | — | 新規 |
   | `tree_pine.png` | 128×128 | — | ✓ | 新規 |
   | `foliage_tuft.png` | 64×64 | — | ✓ | 新規 |
   | `cloud_bank.png` | 128×128 | — | ✓ | 新規 |
   | `water_fall.png` | **128×256** | **上下のみ** | ✓ | 新規（W-1 で寸法変更） |
   | `gate_glow.png` | 64×64 | — | — | 新規・`unlit` |
   | `backdrop_far.png` | 128→**256**×128 | 左右のみ | ✓ | 寸法変更 |
   | `backdrop_near.png` | 128→**256**×128 | 左右のみ | ✓ | 寸法変更 |

   `TextureSpec` に 2 項目を足す。
   - `seamlessY?: boolean`（滝。縦だけ繋がる。`seamlessX` の対）
   - `maxColors?: number`（背景の 2 枚だけ 24。上位計画 §5.2）

   > `maxColors` を `unlit` に紐づけない。`gate_glow` も陰影を受けない絵なので
   > `unlit: true` になるが、色数を緩める理由は無い（緩めるのは背景の 2 枚だけ）。

2. `ADJACENT_PAIRS` に 2 組を足す：`grass_top ↔ stone_floor`、`grass_top ↔ stone_wall`。
3. `import-textures.ts` を書く。原画 → 最頻色で縮小 → セットごとの変換（判断 C）→ 書き出し。
4. gen1 の写像表を宣言する。**色ごとではなく「絵ごとの役割」で書く**（W-4）。

   | 絵 | 使う FC の色（上限） |
   |---|---|
   | `grass_top` | `grass` / `conifer`（**2 色まで**。SG-04 の 16×16 制限） |
   | `stone_floor` | `sand` / `sandstone` |
   | `stone_wall` | `sandstone` / `conifer` |
   | `backdrop_far` | `mesa` / `sandstone` / `conifer`（**3 番号まで**。§5 の第1世代の背景検査） |
   | `backdrop_near` | `white` / `skyDay` |
   | `tree_pine` | `conifer` / `grass` |
   | `foliage_tuft` | `grass` / `conifer` |
   | `cloud_bank` | `white` / `skyDay` |
   | `water_fall` | `white` / `skyDay` |
   | `gate_glow` | `white` / `skyDay` / `mesa` |
   | `vine_green` / `vine_yellow` | **同じ 2 色**（`conifer` / `grass`）。F-1 の前提 |
   | `enemy_body` | `mesa` / `sandstone` / `sand` |

   写像は「原画の色を明度順に並べ、その絵に割り当てられた FC の色へ明度順に対応づける」。
   表に無い色が出たらその場で落とす（黙って最近傍へ逃がさない）。

5. `make-textures.ts` から 13 個の手続きと、対応する `SetColors` の項目を消す。
   残る 4 群の第1世代の色を判断 D の名前へ付け替える。出発点は次の割り当てにする
   （`check:assets` の明度差検査が通ることを確認しながら詰める）。

   | 群 | gen1 の割り当て |
   |---|---|
   | `device`（`metal_grate`） | plate=`sandstone` rim=`skyDay` hole=`conifer` rivet=`sand` |
   | `shell`（`shell_plate`） | plate=`sandstone` seam=`conifer` rivet=`sand` panel=`mesa` |
   | `mark`（`mark_glyph`） | base=`sandstone` line=`sand` deep=`conifer` |
   | `goal`（`pedestal_top`） | stone=`mesa` groove=`sandstone` rim=`sand` inner=`skyDay` |

   > `goal.stone` に `sand` を置いてはいけない。`stone_floor` の 85% が砂色なので、
   > `stone_floor ↔ pedestal_top` の明度差が 0 に近づいて下限 20 を割る。
   > `shell_plate ↔ pedestal_top` も同じ理由で別の明度帯へ分ける。

6. `tools/texture_spec.ts` に6枚の名前と寸法・用途を書き足す。生成と検査はこの同じ表を使う。

**受け入れ**: `npx tsx tools/import-textures.ts && npm run make:textures && npm run check:assets`
が 68 枚すべてで通る。gen1 の 17 枚が宣言した番号へだけ落ちる。

**結果**: [公開検証要約](../VALIDATION.md)（変換規則・4セットの主要な検証結果）

### SG-02 第1世代の 7 色を空のテーマへ

**触るもの**: `src/render/key_palette.ts`、`tests/unit/key_palette.test.ts`

**手順**

1. `KEY_COLORS` に 6 つ足す（`skyDay` `skyHorizon` `grass` `conifer` `sand` `sandstone` `mesa`。
   値は上位計画 §1.1 の実測）。既存の 12 個は消さない。
2. `FC_PALETTE` を判断 D の 7 行へ差し替える。
3. `key_palette.test.ts` に「7 色が空のテーマの用途を持つ」検査を足す。
   既存の 5 件（番号の宣言・重複なし・5 段の系統・背景専用色の実測・表に無い色で落ちる）は
   そのまま通る（判断 D で機械的に確認済み）。

**受け入れ**: `npm run test`。`key_palette.ts` の起動時検査（宣言と最近傍の突き合わせ）が通る。

**結果**: [公開検証要約](../VALIDATION.md)（7色を選んだ結論）

### SG-03 空と遠景の描き直し

**触るもの**: `src/generation/profiles.ts`、`tests/golden/backdrop.test.ts`

**手順**

1. 4 世代の `art.backdrop.sky` を昼の空へ差し替える。

   | 世代 | 上端 | 下端 | 根拠 |
   |---|---|---|---|
   | 第1世代 | `skyDay.source` | 同じ | 上下で色を変えない（ブロックの色数を食う） |
   | 第2世代 | `KEY_COLORS.skyDay` | `KEY_COLORS.skyHorizon` | 縦のグラデーションを持つのはこの世代の署名 |
   | 第3世代 | 彩度を落とした空（**明度 100 以上**） | 同上 | 色が乏しいことが第3世代の姿。霧の色でもある |
   | 第4世代 | `#1574e5` | `#69c4fd` | 基準画の実測そのまま |

   > **第3世代の空だけ下限がある。** 既存のゴールデン「第3世代の遠景には空より
   > 40 以上明るい色が無い」が掛かっており、判断 C の gen3 変換を通した `backdrop_far` の
   > いちばん明るい色は**明度 140.2**（実測）。空の上端が 100 を下回るとこの検査が落ちる。

   **4 世代の代表色が互いに異なること**（既存のゴールデン）を保つ。同じ「昼の空」でも、
   固定 54 色 / RGB555 / 低彩度 / そのまま、で 4 つに割れる。

2. 各層の `repeat` / `scroll` を判断 H の表へ差し替える。
3. ゴールデンを直す。
   - 空の色 4 件（値の差し替え）
   - 第1世代の空が `FC_PALETTE` に載っている（`skyDay` へ）
   - **廃止**: 「第4世代の背景は第3世代より暗い」→ SG-09 の「落ち影を落とすのは第4世代だけ」へ
   - **廃止**: 「第4世代の遠景に空より 120 以上明るい窓がある」→ SG-10 の門の光へ
   - 第3世代の遠景に明るい色が無い（`< 40`）はそのまま残す（上の下限を守れば通る）

**受け入れ**: `npm run test`。4 世代とも昼になり、多重スクロールを持つのは第2世代だけのまま。

**結果**: [公開検証要約](../VALIDATION.md)（差し替えたゴールデンの結論を残す）

### SG-04 天面テクスチャ

**触るもの**: `src/render/material.ts`、`src/render/renderer3d.ts`、
`src/render/shaders/ps1_forward.glsl`、`tools/check-textures.ts`

**手順**

1. `Material.topTexture: string | null` を足す（既定 null）。
2. 足場の材質を差し替える：`platform` / `island` / `bridge_far` を
   側面 `stone_wall.png` ＋ 天面 `grass_top.png` にする。暗室の `causeway` は触らない
   （空の見えない部屋に草は生えない）。
3. シェーダに `uniform sampler2D uTopColor` を足し、`vNormal.y > 0.5` で切り替える。
4. `renderer3d.ts` の `drawItem` / `drawPlane` / `drawShadows` / `drawPlayerSprite` /
   `drawPlayerModel` の 5 か所すべてで 2 枚目を束ねる（持たない材質は 1 枚目と同じ絵）。
5. `check-textures.ts` に「天面テクスチャが 4 セットすべてに揃う」を足す。

**受け入れ**: ドローコールが増えない（`triangleCount` と `drawElements` の回数が変わらない）。
第1世代で天面の緑・側面の砂色・目地の 3 色に収まる。

**結果**: [公開検証要約](../VALIDATION.md)

### SG-05 装飾の経路

**触るもの**: `src/render/material.ts`、`src/render/frame.ts`、`src/gameplay/scene.ts`、
`tools/check-levels.ts`、`tests/unit/scene.test.ts`

**手順**

1. `Material.decoration: boolean` を足す（既定 false）。
2. `FrameDrawable` に `position: Vec3`（レベルが置いた静止位置）を足す。
3. `buildDrawables` を全要素へ広げる。大きさは `collider?.halfExtents ?? transform.scale ?? [1,1,1]`。
4. `scene.ts` の `update` で、`bodies.get(key)` が無い要素は `drawable.position` に置いて可視にする
   （現在は不可視にして落としている。`scene.ts:102`）。
5. `check-levels.ts` に同値の検査を足す（判断 E）。

**受け入れ**: `npm run check:levels` が通り、`requiredGenerations` は 1 つも変わらない。
`session.bodies()` の件数が変わらない（装飾は物理にも投影にもパズルにも現れない）。

**結果**: [公開検証要約](../VALIDATION.md)

### SG-06 草木を置く

**触るもの**: `src/render/material.ts`、`public/assets/levels/area1.json`

**手順**

1. 材質を 3 つ足す。いずれも `model: 'props_vine'`（交差する 2 枚の板・8 三角形）、
   `alphaCutoff: 0.5`、`decoration: true`、`uvScale: 0`。
   - `tree`（`tree_pine.png`）
   - `bush`（`foliage_tuft.png`）
   - `flower`（`foliage_tuft.png`。`scale` を小さくして房として置く）
2. `area1.json` に装飾要素を足す。**8 セクタすべてに置く**。位置は 0.25 グリッド、
   `collider` は書かない、`sector` は既存のものを指す。

**受け入れ**: 第1世代でもシルエットが読める（16 画素まで縮めて確認）。
追加の三角形が §6 の見積りの内側。`npm run check:levels` が通る。

**結果**: [公開検証要約](../VALIDATION.md)（4世代の結論と配置数）

### SG-07 足元の雲海と浮遊する立方体

**触るもの**: `src/render/material.ts`、`src/render/renderer3d.ts`、
`src/render/frame.ts`、`public/assets/levels/area1.json`

**手順**

1. 材質を 2 つ足す。
   - `cloud`（`cloud_bank.png`・`props_vine`・`alphaCutoff: 0.5`・`decoration`）
   - `sky_cube`（`stone_wall.png` の天面に `grass_top.png`。基準画の浮遊する立方体は
     足場と同じ材質でできている。**語彙を増やさない**）
2. `Material.float: number`（上下する振幅 m。0 は動かない）を足す。
   位相は要素の位置から作る（同じ入力から同じ動き。不変条件 I4）。
3. `renderer3d.ts` の `drawItem` で `frame.timeSeconds` と `motionAmount()` から Y を足す。
   **`gameplay/` は知らない**（`frame.positions` は書き換えない）。
4. `area1.json` に雲の板を足場の下（-6m 前後）へ敷き、立方体を空へ散らす。

**受け入れ**: 回廊が浮いて見える。`motionAmount() === 0` で立方体が完全に止まる。

**結果**: [公開検証要約](../VALIDATION.md)

### SG-08 滝

**触るもの**: `src/render/material.ts`、`src/render/shaders/ps1_vertex.glsl`、
`src/render/renderer3d.ts`、`public/assets/levels/area1.json`

**手順**

1. `Material.uvScrollY: number`（1 秒あたりに送る UV。0 は送らない）を足す。
2. 頂点シェーダに `uniform vec2 uUvScroll` を足し、UV へ加える
   （フラグメント側でずらすとアフィン補間の前後がずれる）。
3. 材質 `waterfall`（`water_fall.png`・`props_vine`・`alphaCutoff: 0.5`・`decoration`・
   `uvScrollY: 0.35`）を足し、島の縁へ 6 本ほど置く。
4. `uvScrollY` にも `motionAmount()` を掛ける。

**受け入れ**: 加算合成を持たない第1世代でも抜きで成立する（`translucent: false` のまま）。
第3世代のリプレイ（`p1_2_sort_break.replay.json`）が通る＝三角形ソートを壊していない。

**結果**: [公開検証要約](../VALIDATION.md)

### SG-09 太陽光と空色の環境光

**触るもの**: `src/render/shaders/ps1_forward.glsl`、`src/render/renderer3d.ts`、
`tests/golden/backdrop.test.ts`

**手順**

1. `uniform float uAmbient` → `uniform vec3 uAmbient`。
2. `renderer3d.ts` で `tint = 空の下端色 ÷ その明度 × frame.backdrop.brightness` を作り、
   `material.ambient` に掛けて渡す（判断 G）。影の板とスプライトは `[1,1,1]`。
3. 「落ち影を落とすのは第4世代だけ」のゴールデンを足す
   （`video.dynamicLight` が真な世代とちょうど一致することを見る。世代 ID は書かない）。

**受け入れ**: 暗室（`ambient: 0.05`）の明度が変わらない。`chaos/no-generation-branch` が通る。

**結果**: [公開検証要約](../VALIDATION.md)

### SG-10 目標＝光る門

**触るもの**: `tools/blender_export_props.py`、`tools/glyph_heart.ts`（新規）、
`tools/import-textures.ts`、`src/render/material.ts`、`tests/golden/backdrop.test.ts`

**手順**

1. `blender_export_props.py` に `build_gate()` を足す。段積みの石塔＋中央のアーチ。
   **[-1, 1] の単位箱**に収める（`gltf-preflight.ts` が機械的に見る）。
2. `make-textures.ts` の `heart()` を `tools/glyph_heart.ts` へ出し、
   取り込み時に `gate_glow.png` の中心へ重ねる（判断 J、KV-09 の語彙）。
3. 材質 `goal` / `pedestal` を門へ差し替える。門の光の面は `ambient: [1,1,1]`・`diffuse: 0`
   （光そのものなので陰影を受けない）。
4. ゴールデン「門の光が空より 120 以上明るい」を足す（SG-03 で外した窓の検査の置き換え）。

**受け入れ**: 4 セットとも中心が空より 120 以上明るい。KV-09 の紋の検査が門でも通る。

**結果**: [公開検証要約](../VALIDATION.md)

### SG-11 4 世代を並べる・予算・検査

**触るもの**: [公開検証要約](../VALIDATION.md)、`tests/unit/`（三角形の見積り）

**手順**

1. `?scene=mini&level=area1&playtest=0` を 4 チャンネルぶん撮り直し、
   `sg-00_current_CH1..4.png` と並べる。撮影は `window.__chaos` で 1 フレーム進めて撮る
   （`m.state.crtQuality = 'off'` にしてから読むと色が正しく測れる）。
2. 第3世代 20,000 / 第4世代 80,000 三角形の**実測**を残す（`renderer.triangleCount`）。
3. 判断 F の道（装飾の板）が画面で成立しているかを判断し、退避先を採るなら記録に残す。
4. 第4世代のカメラを基準画と比べて判断する（BR-04 で第3世代を寄せたのと同じ作業）。

---

## 4. 検査の一覧（ファイル別）

| ファイル | 足す / 直す |
|---|---|
| `tools/texture_spec.ts` | 6 枚追加・2 枚の寸法変更・`seamlessY` と `maxColors` の追加・`ADJACENT_PAIRS` に 2 組 |
| `tools/check-textures.ts` | `seamlessY` の検査・`maxColors` の参照・天面テクスチャが 4 セットに揃う |
| `tools/check-levels.ts` | 装飾の材質と `collider` の不在が同値 |
| `tests/golden/backdrop.test.ts` | 空の色 4 件を差し替え・「第4世代は暗い」を削除・「窓」を「門の光」へ・落ち影の署名を追加 |
| `tests/golden/material.test.ts` | 装飾の材質が 4 セットに絵を持つ（既存の一覧検査がそのまま広がる） |
| `tests/unit/key_palette.test.ts` | 空のテーマの 7 用途 |
| `tests/unit/scene.test.ts` | 装飾が `session.bodies()` に現れない |
| `tests/unit/`（新規） | 三角形の見積りが第3世代 20,000 / 第4世代 80,000 の内側 |
| `tools/texture_spec.ts` | 新しい6枚の名前、寸法、用途（生成と `check:assets` の正本） |

既存のまま通り続けるべきもの（**触らない**）:
`check:levels` の `requiredGenerations` 一致、`chaos/no-generation-branch`、
第2世代だけが層を 2 枚持つ、第3世代だけが霧を持つ、F-1 のツタ 2 本の潰れと読み分け、
KV-09 の紋の輪郭、リプレイ 11 件。

---

## 5. 順番

```
SG-01 ──┬── SG-03 ──┬── SG-09
        │           │
SG-02 ──┘           └── SG-11
        │
        ├── SG-04 ──┬── SG-10
        │           │
SG-05 ──┴── SG-06 ──┤
        ├── SG-07 ──┤
        └── SG-08 ──┘
```

- **SG-01 と SG-02 は同時に書く。** gen1 の写像（SG-01）が 7 色（SG-02）を参照するので、
  片方だけでは `check:assets` が通らない。1 つの区切りとして扱う
- **SG-05 は SG-01 を待たない。** 装飾の経路は絵と無関係で、既存のツタの絵でも動く
- SG-06 / SG-07 / SG-08 は互いに独立。どれか 1 つが詰まっても他は進む
- SG-11 は 4 世代を同時に見る作業なので、最後にまとめて 1 回で行う

各区切りの終わりで `npm run verify` を通す（lint → test → 予算 → レベル → 商標 → アセット → build）。

---

## 6. 三角形の見積り

現状の area1 は 72 個の箱で **4,548 三角形**（カリング前の全量）。

| 足すもの | 個数 | 1 つあたり | 小計 |
|---|---|---|---|
| 木・茂み・草の房（`props_vine`） | 約 100 | 8 | 800 |
| 雲の板（`props_vine`） | 約 30 | 8 | 240 |
| 滝（`props_vine`） | 約 6 | 8 | 48 |
| 浮遊する立方体（分割つきの箱・半径 0.25m） | 約 20 | 12 | 240 |
| 道の板（薄い箱・4×2m） | 約 24 | 56 | 1,344 |
| 門（`props_gate`） | 1 | 約 200 | 200 |
| **合計** | | | **約 2,900** |

合計 **約 7,400 三角形**。第3世代の予算 20,000 に対して 37%、第4世代の 80,000 に対して 9%。
道の板がいちばん重いので、判断 F の退避先を採る場合はここが 1,344 ぶん軽くなる。

---

## 7. リスク

| # | リスク | 兆候 | 対処 |
|---|---|---|---|
| R-1 | gen1 の写像で `backdrop_far` の透明率が 50% を割る | `backdrop.test.ts` の「遠景は敷き詰めない」が落ちる | アルファを触らない規則（W-3）を守る。それでも割れるなら稜線の 1 段を透明へ |
| R-2 | gen1 の 7 色で仕掛け（`metal_grate` 等）が床と分離しない | `check:assets` の明度差が 20 を割る | SG-01 手順 5 の割り当て表を明度帯で組み直す。色相では分離しない（T1-08 §4） |
| R-3 | 道の板が第3世代でちらつく | 三角形ソートの結果が床と入れ替わる | 判断 F の退避先（天面を石畳に戻す）へ。SG-11 で判断する |
| R-4 | 装飾を足したことで `area1.json` の要素数が 3 倍近くになり、読みづらくなる | — | 装飾はファイル末尾にまとめ、`id` の頭を `decor_` で揃える |
| R-5 | 第4世代の空を昼にしたことで、暗室（P2-1）の対比が弱まる | 暗室が「暗い部屋」に見えない | `frame.backdrop.brightness` は既に場所で決まる。SG-11 で見て、必要なら暗室の遷移時間だけ詰める |
| R-6 | `make-textures.ts` を削るときに `SetColors` の消し漏れが出る | `lint`（未使用）で落ちる | 手続きと色表を同じ区切りで消す |

---

## 8. やらないこと

上位計画 §7 をそのまま引き継ぐ。本書で新たに加える 3 つ。

| やらないこと | 理由 |
|---|---|
| 汎用の「装飾システム」（配置ルール・散布アルゴリズム） | 装飾は `collider` を持たない要素というだけのもので、機構ではない（§11.1.1） |
| 道・草・花の自動配置ツール | area1 の 1 ステージぶんを手で置けば済む。2 つ目のステージが実在してから考える |
| `pedestal_top.png` の取り込み | 判断 J。KV-09 の紋の語彙を守るほうを優先する |
