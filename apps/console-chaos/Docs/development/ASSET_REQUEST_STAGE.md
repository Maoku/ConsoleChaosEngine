# 素材制作依頼リスト（試作ステージ「エメラルドの空」）

計画: [GRAPHICS_STAGE_PLAN.md](GRAPHICS_STAGE_PLAN.md)（SG-01〜SG-11）
基準画: [concept/stage-02-emerald-sky-gen-04.png](../concept/stage-02-emerald-sky-gen-04.png)

本書は**発注仕様の正本**である。テクスチャの実体（PNG）はリポジトリに入るが、
「同じ意図から作り直せる状態」を保つのは本書の役目になる
（計画 §3 の決定 8。`asset-rules.md` §9 でモデルにスクリプトが果たしている役目と同じ）。

---

## 0. 依頼の全体像

### 0.1 1 素材につき原画は **1 枚だけ**

納品してもらうのは**第4世代の原画 1 枚**。
第3・第2・第1世代のセットは `tools/import-textures.ts`（SG-01）が原画から機械的に作る。

| セット | 作り方 | 出る絵 |
|---|---|---|
| gen4 | 原画を 128px へ縮小し、10 色へ減色 | 原画に最も近い |
| gen3 | 彩度を落として灰緑〜灰青の 1 系統へ寄せる | 色が乏しく平坦 |
| gen2 | RGB555 へ丸め、彩度を上げる | 明るく色数が多い |
| gen1 | 固定 54 色（`FC_PALETTE` の 7 色）へ写像 | 色が 7 つしかない |

**セットごとに絵を発注しない。** 形が揃わなくなるうえ、
「同じ 1 つの空間を、粗い規格で映すと下位世代になる」という本作の主題とも食い違う。

### 0.2 納品形式

| 項目 | 指定 |
|---|---|
| 形式 | PNG（**非可逆圧縮を使わない**）。透過が要るものは RGBA |
| 寸法 | 各素材の「原画寸法」欄。**最終寸法の 4 倍**で納品する（縮小は取り込み側で行う） |
| 色 | sRGB |
| 命名 | 最終ファイル名の頭に `src_` を付ける（例 `src_grass_top.png`）。小文字スネークケース |
| 置き場所 | `Docs/concept/source/`（原画。ビルドには含まれない） |
| 枚数 | 1 素材につき 1 枚 |

### 0.3 全素材に共通する制約（**これを外すと CI が落ちる**）

`tools/check-textures.ts` が取り込み後の PNG を機械的に検査する。
原画の時点で次を守っておかないと、減色したときに形が消える。

| # | 制約 | 理由（どの検査に効くか） |
|---|---|---|
| 1 | **陰影を焼き込まない。** 落ち影・アンビエントオクルージョン・レンダリングの照り返しを描かない | 陰影は世代ごとにシェーダが付ける。焼き込むと二重に暗くなる |
| 2 | **平坦に塗る。** グラデーション・ぼかし・ノイズ・ディザを使わない | 同色の連続が平均 4 画素以上必要（`MIN_RUN_LENGTH`） |
| 3 | **色数は 10 前後に絞る。** 上限は 12（背景の層のみ 24） | `MAX_COLORS` |
| 4 | **淡い色（低彩度・高明度）を使わない。** 白は差し色としてのみ | 明度を掛けると中間灰へ落ちて形が消える（`familyIssue`） |
| 5 | **輪郭ははっきり。** 半透明のふちを作らない（アルファは 0 か 255） | 半透明合成を持たない第1世代でも成立させる |
| 6 | **敷き詰める絵は、軸に沿った直線構造を持つ**（横一列・縦一列がまったく同じ画素になる行／列が 30% 以上） | 第3世代のアフィン歪みは直線が曲がって初めて見える |
| 7 | **正面から見た平行投影。** 遠近・消失点・傾きを付けない | テクスチャは面に貼るもので、立体ではない |
| 8 | **文字・数字・記号・ロゴ・署名・枠を入れない** | `npm run check:trademark` と §7.1.1 |
| 9 | **既存の作品名・ブランド名・実在ハードウェア名をプロンプトに書かない** | 本作は独自実装であり、特定作品の模倣ではない（README の宣言） |

### 0.4 プロンプトの共通部分

以下を全素材のプロンプトの前後に付ける。素材ごとの節には**固有部分だけ**を書く。

**共通の前置き（英語）**

```
flat 2D game texture, hand-painted stylized cartoon style, orthographic straight-on view,
no perspective, evenly lit, no baked shadows, no ambient occlusion, no drop shadow,
posterized into about 10 solid flat colour steps, crisp hard edges, no gradients,
no soft shading, no noise, no grain, no dithering, no text, no logo, no watermark
```

**共通の除外（negative prompt）**

```
photo, photorealistic, 3d render, depth of field, blur, bokeh, vignette, gradient,
soft shading, ambient occlusion, baked shadow, noise, grain, dithering, film grain,
text, letters, numbers, signature, watermark, logo, border, frame, perspective,
tilted view, character, person, animal
```

---

## 1. 一覧

| ID | ファイル名（最終） | 最終寸法 | 原画寸法 | 継ぎ目 | 透過 | 優先度 | 状態 |
|---|---|---|---|---|---|---|---|
| A-01 | `grass_top.png` | 128×128 | 512×512 | 上下左右 | なし | **必須** | 新規 |
| A-02 | `stone_floor.png` | 128×128 | 512×512 | 上下左右 | なし | **必須** | 描き直し |
| A-03 | `stone_wall.png` | 128×128 | 512×512 | 上下左右 | なし | **必須** | 描き直し |
| A-04 | `backdrop_far.png` | 256×128 | 1024×512 | 左右のみ | あり | **必須** | 描き直し |
| A-05 | `backdrop_near.png` | 256×128 | 1024×512 | 左右のみ | あり | **必須** | 描き直し |
| A-06 | `tree_pine.png` | 128×128 | 512×512 | なし | あり | **必須** | 新規 |
| A-07 | `foliage_tuft.png` | 64×64 | 256×256 | なし | あり | **必須** | 新規 |
| A-08 | `cloud_bank.png` | 128×128 | 512×512 | なし | あり | **必須** | 新規 |
| A-09 | `water_fall.png` | 64×128 | 256×512 | 上下のみ | あり | 推奨 | 新規 |
| A-10 | `gate_glow.png` | 64×64 | 256×256 | なし | なし | 推奨 | 新規 |
| A-11 | `vine_green.png` / `vine_yellow.png` | 64×128 | 256×512 | なし | あり | 推奨 | 描き直し |
| A-12 | `pedestal_top.png` | 64×64 | 256×256 | なし | なし | 任意 | 描き直し |
| A-13 | `enemy_body.png` | 64×64 | 256×256 | なし | あり | 任意 | 描き直し |

> `metal_grate.png` / `shell_plate.png` / `mark_glyph.png` は**発注しない**。
> 仕掛けと紋は「人工物」として空の風景から浮いているほうがよく、KV-09 で決めた紋の語彙も維持する。
>
> モデルは `props_gate`（A-10 が貼られる門）1 つだけが新規で、
> `tools/blender_export_props.py` に書いて出す（`asset-rules.md` §9。**発注しない**）。
> 木・茂み・雲・滝は既存の `props_vine`（交差する 2 枚の板）を使い回すので、モデルは要らない。

---

## 2. 素材ごとの発注

### A-01 `grass_top.png` — 足場の天面（草）

**用途**: すべての足場の上面。画面でいちばん面積が広くなる（計画 決定 4）。

**主旨**: 上から見た草地。基準画の草は黄緑（`#b5bb27`）で、深い緑（`#183508`）の房が散る。
**格子状の構造を残すこと**——完全にランダムな草だと、第3世代のアフィン歪みが読めない。

```
seamless tileable top-down grass ground texture for a stylized platformer,
bright yellow-green turf (#b5bb27) as the base, darker green clumps (#537336) arranged
on a loose 4x4 grid, a few very dark green tufts (#183508), scattered tiny white and
yellow four-petal flowers, subtle straight horizontal and vertical seams between turf
patches so the grid reads clearly, flat cel-shaded colours
```

**受け入れ条件**
- 上下左右がタイル状に繋がる
- 4×4 の区画の境目が**直線として読める**（検査 6）
- 白い花は差し色として面積 3% 以内（面積が増えると第1世代で草の色を食う）
- A-02（道）との明度差が 20 以上

---

### A-02 `stone_floor.png` — 道の石畳（描き直し）

**用途**: 草の上に敷かれた道。基準画では砂色（`#f9c976`）の四角い板が並ぶ。

**主旨**: 現行の「古い石畳」を、**砂色の平板**に描き替える。
格子は正方形 4×4 のまま（目地が第3世代の歪みを見せる骨格になっている）。

```
seamless tileable top-down stone path texture, four by four grid of square sandstone
slabs, warm sand colour (#f9c976) with two slightly darker sand tones, straight
narrow mortar lines running horizontally and vertically in a muted brown (#946a47),
a few slabs chipped at the corner showing the darker tone underneath,
flat cel-shaded colours, no moss, no cracks with soft edges
```

**受け入れ条件**
- 上下左右がタイル状に繋がる
- 目地が縦横に**通る**（途切れない）
- A-01（草）と明度で 20 以上離れる

---

### A-03 `stone_wall.png` — 足場の側面（砂岩ブロック）（描き直し）

**用途**: 足場の側面と壁。基準画では横目地の通った砂岩レンガ（`#946a47`）。

**主旨**: 現行の「横長の石を積んだ壁」の構造を保ったまま、色と質を砂岩へ寄せる。
**天面（A-01）より 1 段暗く**、道（A-02）より暗い。

```
seamless tileable stylized sandstone brick wall texture seen straight on,
four horizontal courses of wide rectangular blocks, vertical joints offset by half a
block between courses, warm brown sandstone (#946a47) with two lighter tones,
dark brown mortar lines (#5a4028) running perfectly horizontal,
flat cel-shaded colours, clean geometric blocks
```

**受け入れ条件**
- 上下左右がタイル状に繋がる
- 水平の目地が端から端まで通る
- A-01 / A-02 の両方と明度差 20 以上

---

### A-04 `backdrop_far.png` — 遠景のメサ（描き直し）

**用途**: 背景の遠景の層。横に繰り返して地平に並ぶ（計画 決定 5）。
**寸法が 128×128 から 256×128 へ変わる**（`tools/texture_spec.ts` も同時に更新する）。

**主旨**: 赤茶の層状の台地（メサ）が地平に並ぶ。**上端は透明で空が抜ける。**
基準画の最大の特徴は**遠いほど空色へ溶ける**こと（`#e6988a` → `#7886aa`）。
これは霧ではなく**絵に描き込む**（計画 決定 6）。

```
seamless horizontally tiling side-view silhouette band of layered mesa cliffs for a
game backdrop, stepped terraces made of stacked rectangular blocks, warm red-brown
rock (#e6988a) for the nearest ridge, a paler blue-shifted ridge (#7886aa) behind it
to read as atmospheric distance, small dark green conifer shapes on the flat tops,
transparent above the skyline, flat cel-shaded colours, straight horizontal terrace
edges, alpha channel transparent background
```

**受け入れ条件**
- **左右の端が繋がる**（上下は繋がらなくてよい）
- 上端が完全に透明（アルファ 0）
- 手前の稜線と奥の稜線が**明度と彩度の両方で**分かれている
- 色数 24 以内（背景の層のみの上限。計画 §5.2）

---

### A-05 `backdrop_near.png` — 高い薄雲（描き直し）

**用途**: 背景の近景の層。**多重スクロールを持つ第2世代だけが使う**（計画 決定 5）。
寸法は A-04 と同じく 256×128 へ変わる。

**主旨**: 横に伸びる雲の帯が 2 段。上下は透明。輪郭は角張らせる（にじませない）。

```
seamless horizontally tiling band of stylized flat cartoon clouds,
two rows of horizontal cumulus shapes with hard stepped outlines,
near-white blue-tinted highlight (#dbe4fb) on top of each cloud and a cooler
blue-grey underside (#97b7ed), transparent above and below the cloud band,
flat cel-shaded colours, no soft edges, no fog, alpha channel transparent background
```

**受け入れ条件**
- 左右の端が繋がる
- 上下端が完全に透明
- **純白を使わない**（基準画に純白は無い。白は門の光にだけ残す）
- 色数 24 以内

---

### A-06 `tree_pine.png` — 針葉樹

**用途**: 交差する 2 枚の板に貼って木にする（既存の `props_vine` と同じ作り）。
アルファ抜きで形を出すので、**絵そのものが木のシルエットになる**。

**主旨**: 真横から見た針葉樹 1 本。基準画の木は三角形が 3〜4 段重なった形で、
幹は短く暗い。**第1世代（7 色・低解像度）でもシルエットが読めること**が最優先。

```
single stylized conifer tree seen from the side, straight-on flat view,
three or four stacked triangular tiers of foliage with hard stepped silhouette edges,
deep green (#1a4936) foliage with one lighter green tone (#537336) on the upper-left
of each tier, short dark brown trunk at the bottom centre, tree occupies the full
height of the frame with the trunk base touching the bottom edge,
fully transparent background, flat cel-shaded colours, bold readable silhouette
```

**受け入れ条件**
- 背景が完全に透明（アルファ 0）、輪郭に半透明の画素が無い
- **幹の下端が絵の下端に接している**（接地線がセルの下端になる）
- 横位置は絵の中心（左右に振らない）
- 16 画素まで縮めても「木」と読める

---

### A-07 `foliage_tuft.png` — 草の房と小花

**用途**: 地面に散らす小さな装飾。交差する 2 枚の板。

**主旨**: 真横から見た草の房 1 つ。基準画では草の房に白・黄・青の小花が混じる。

```
small clump of stylized grass blades seen from the side, straight-on flat view,
five to seven upright pointed blades in bright yellow-green (#b5bb27) and a darker
green (#537336), two small four-petal flowers among the blades, one white and one
cornflower blue (#4a7fd0), blades touching the bottom edge of the frame,
fully transparent background, flat cel-shaded colours, hard edges, bold silhouette
```

**受け入れ条件**
- 背景が完全に透明、半透明の画素が無い
- 草の根元が絵の下端に接している
- 花は 2 つまで（増やすと第1世代で色を食う）

---

### A-08 `cloud_bank.png` — 足元の雲海

**用途**: **ワールドに置く板**。足場より下に敷き、回廊が浮いて見えるようにする（計画 決定 5）。

**主旨**: 真横から見た積雲の塊 1 つ。上面が明るく、下面が空色に沈む。
**上下端は透明**にして、複数枚を重ねたときに境目が出ないようにする。

```
single stylized cumulus cloud seen from the side, straight-on flat view,
rounded stacked lobes with hard stepped outlines, pale blue-white top (#dbe4fb),
mid blue-grey body (#97b7ed) and a cooler blue underside (#6f93cf),
cloud centred in the frame with transparent margins on all four sides,
flat cel-shaded colours, no soft edges, no wisps, no thin trailing strands,
alpha channel transparent background
```

**受け入れ条件**
- 四辺に透明の余白があり、輪郭に半透明の画素が無い
- 上面と下面が**明度で**分かれている（重ねたときに厚みが読める）
- 純白を使わない

---

### A-09 `water_fall.png` — 滝（推奨）

**用途**: 島の縁から落ちる水。UV を縦に流す（SG-08）。

**主旨**: 上から下へ流れる水の帯。**上下が繋がること**（縦にスクロールし続けるため）。
半透明合成を持たない第1世代でも成立するよう、**抜きで**形を作る。

```
vertically seamless tiling waterfall texture, straight-on flat front view,
continuous vertical streams of falling water, three or four straight vertical bands
of differing width, pale blue-white (#c8d8f0) highlights on the left of each band and
cooler blue (#a7b7d9) in between, a few short horizontal foam dashes,
narrow fully transparent gaps between the bands, flat cel-shaded colours,
hard edges, no spray, no mist, alpha channel transparent background
```

**受け入れ条件**
- **上下の端が繋がる**（左右は繋がらなくてよい）
- 縦の帯が絵の上端から下端まで通る（途中で切れない）
- 半透明の画素が無い（アルファは 0 か 255）

---

### A-10 `gate_glow.png` — 門の光（推奨）

**用途**: 目標の門の中心に光る縦長のアーチ（SG-10）。**画面でいちばん明るい面**になる。

**主旨**: 基準画の門は、段積みの石塔の中央に白く光る縦長のアーチを持つ。
この絵は光そのもので、陰影を受けない。

```
tall vertical arched portal of light seen straight on, flat front view,
rounded top and flat bottom, the interior filled with a very pale cyan-white
(#e3f7fd) core surrounded by two concentric bands of pale cyan (#a8dcf5) and
bright blue (#3ba6fd), the outermost ring a saturated deep blue,
the corners of the frame filled with the deep blue, sharp concentric edges,
flat cel-shaded colours, no rays, no sparkles, no lens flare
```

**受け入れ条件**
- 中心の色が空の色より明度で 120 以上明るい
- 同心の帯の境目が**はっきり**している（第1世代でも 3 色に落として形が残る）

---

### A-11 `vine_green.png` / `vine_yellow.png` — 島の下に垂れるツタ（推奨）

**用途**: F-1 のパズルで使う 2 本のツタ。**形が完全に一致し、色だけが違うこと**が
パズルの成立条件（第1世代で 2 本が同じ 1 色に潰れる）。

**主旨**: 基準画では島の下面からツタが垂れている。現行の絵の構造は保ち、
葉の形と色を空のテーマへ寄せる。**2 枚は同じ形**で、色違いとして納品する。

```
single thick vine hanging straight down, straight-on flat side view,
one vertical stem running from the top edge to the bottom edge of the frame,
three large rounded leaf clusters attached alternately left and right,
[GREEN 版] deep saturated green stem (#1a4936) with mid green leaves (#537336)
[YELLOW 版] identical shape, olive stem (#4a5010) with yellow-green leaves (#a8c828)
fully transparent background, flat cel-shaded colours, hard edges
```

**受け入れ条件**
- **2 枚のアルファが完全に一致する**（形が同じ。CI が画素単位で見る）
- 茎が絵の上端から下端まで通る
- 2 枚の色が、第2世代以降では明確に別の緑として読める

---

### A-12 `pedestal_top.png` — 台座の天面（任意）

**用途**: 目標の台座と P1-2 の核。門（A-10）を入れるなら、そちらへ役目が移る。

```
circular carved stone medallion seen from directly above, flat top-down view,
concentric rings with radial straight grooves, warm sandstone (#f9c976) surface,
darker brown grooves (#946a47), a bright cyan-white ring (#e3f7fd) as the outer rim,
square frame with the corners filled by plain sandstone,
flat cel-shaded colours, hard edges
```

---

### A-13 `enemy_body.png` — 敵（任意）

**用途**: F-2 で 10 体並ぶ生き物。**16 画素まで縮んでも目の位置が分かること**が条件。

```
simple cartoon creature seen from the front, flat straight-on view,
round compact body, two very large round eyes with small dark pupils as the dominant
feature, deep violet body (#4a2a5c) with a darker underside, pale yellow eyes,
bold dark outline, fully transparent background, flat cel-shaded colours, hard edges
```

---

## 3. 受け入れ検査（納品後にこちらで回すもの）

```bash
npx tsx tools/import-textures.ts && npm run check:assets
```

| 検査 | 落ちたときに直すところ |
|---|---|
| 4 セットに同じ一覧が揃う | 取り込みスクリプト |
| 色数（通常 12 / 背景の層 24）以内 | 原画の色数を減らす |
| 同色の連続が平均 4 画素以上 | 原画のグラデーション・ノイズを消す |
| 敷き詰める絵の直線構造が 30% 以上 | 原画の格子構造を直線にする |
| 端が繋がる | 原画のタイル性 |
| 淡色（低彩度・高明度）が無い | 原画の色を彩度側へ寄せる |
| 透過の有無が仕様どおり | アルファの塗り |
| 第1世代セットが `FC_PALETTE` の宣言どおりの番号へ落ちる | 取り込みの写像表（原画側では直せない） |
| ツタ 2 本の形が一致する | A-11 の 2 枚 |
| 隣り合う組の明度差が 20 以上 | A-01 / A-02 / A-03 の明度設計 |

---

## 4. 納品チェックリスト（依頼先へ渡す短縮版）

- [ ] PNG（非可逆圧縮なし）、sRGB、指定の原画寸法
- [ ] 正面からの平行投影。遠近・傾きなし
- [ ] 陰影・落ち影・アンビエントオクルージョンを描いていない
- [ ] グラデーション・ぼかし・ノイズ・ディザが無い（平坦な塗り）
- [ ] 色数がおおむね 10 前後
- [ ] 淡い色（低彩度で明るい色）を使っていない
- [ ] アルファは 0 か 255 だけ（半透明のふちが無い）
- [ ] 敷き詰める絵は端が繋がり、軸に沿った直線が通っている
- [ ] 文字・数字・記号・ロゴ・署名・枠が無い
- [ ] 既存の作品名・ブランド名・ハードウェア名をプロンプトに使っていない
