# アセット規則（glTF サブセットの対応範囲）

> 対象読者：モデル・テクスチャを作る人。
> 本書は [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) §8.1 T0-07 の成果物であり、
> `src/render/loader/gltf.ts` が実際に読める範囲を定義する。
> ここに書かれていない機能は**ローダが明示的に失敗する**（黙って無視しない）。
>
> 範囲外のアセットは `npm run check:assets`（`tools/gltf-preflight.ts`）が CI で弾く。

初版：フェーズ 0 Week 1。範囲を広げる場合は本書とローダとプリフライトの 3 点を同時に更新する。

---

## 1. なぜ範囲を絞るか

GAME_PLAN §11.1.1 の思想（汎用抽象は取り除く対象になる）をアセットにも適用する。
「読めるかもしれない機能」を増やすと、ローダは太り、実機らしい見えとは無関係な分岐が残る。
**足りないと分かった時点で範囲を広げる**のが原則で、先回りしない。

---

## 2. ファイル形式

| 項目 | 規則 |
|---|---|
| 形式 | glTF 2.0（`.gltf` + 外部 `.bin`、`.gltf` の data: URI 埋め込み、`.glb` のいずれか） |
| バージョン | `asset.version` が `2.x` であること。1.0 は不可 |
| 拡張 | `extensionsRequired` を持たないこと（Draco 圧縮を含む） |
| 置き場所 | `public/assets/models/` |
| 命名 | 小文字スネークケース。実機名・商標由来語を含まない（GAME_PLAN §7.1.1、`npm run check:trademark`） |

---

## 3. メッシュ

| 項目 | 対応 | 備考 |
|---|---|---|
| プリミティブ mode | `TRIANGLES` のみ | 線・点・ストリップは不可 |
| インデックス | **必須** | 非インデックスメッシュは不可 |
| `POSITION` | 必須 | float VEC3 |
| `NORMAL` | 任意 | 無い場合はゼロ法線として扱う |
| `TEXCOORD_0` | 任意 | float VEC2 |
| `TEXCOORD_1` 以降 | **不可** | 複数 UV セットは使わない |
| `COLOR_0` / `TANGENT` | 読まない | 出力しても無視される（サイズの無駄） |
| モーフターゲット | **不可** | 表情・形状変化はボーンで表現する |
| スパースアクセサ | **不可** | |
| インターリーブ | 可 | `byteStride` 付きで読める |

---

## 4. ノード階層

| 項目 | 規則 |
|---|---|
| 変換 | **TRS（translation / rotation / scale）で出力すること** |
| `matrix` | **不可**。ローダは分解処理を持たない（エクスポート設定で TRS を選ぶ） |
| シーン | 先頭シーン（`scene`）のノードをルートとして扱う |
| 座標系 | glTF 標準（右手系、Y が上、−Z が前）。ゲーム側もこの向きに合わせる |
| 単位 | 1.0 = 1 メートル。プレイヤーの身長は約 1.6 |

---

## 5. スキニング

| 項目 | 規則 |
|---|---|
| `JOINTS_0` / `WEIGHTS_0` | 1 セットのみ（頂点あたり最大 4 ボーン影響） |
| `JOINTS_1` 以降 | **不可** |
| `inverseBindMatrices` | 必須（省略時は単位行列とみなすが、明示すること） |
| ジョイント数 | **1 スキンあたり 24 まで**（シェーダの `uJoints[24]` に合わせる） |
| ウェイト | 正規化して出力すること（合計 1.0） |

---

## 6. アニメーション

| 項目 | 規則 |
|---|---|
| 対象パス | `translation` / `rotation` / `scale` のみ |
| `weights`（モーフ） | **不可** |
| 補間 | `LINEAR` / `STEP` のみ。**`CUBICSPLINE` は不可** |
| 尺 | 秒で持つ。ループ前提のクリップは先頭と末尾のキーを一致させる |

> **世代ごとのコマ落ちはアセット側で作らない。** FC のボーンアニメ 6fps 化は
> 再生時刻の量子化で表現する（`sampleAnimation` に量子化した時刻を渡す）。
> アニメーションは常に滑らかなものを 1 本だけ作る。

---

## 7. マテリアルとテクスチャ

| 項目 | 規則 |
|---|---|
| 読む値 | `pbrMetallicRoughness.baseColorFactor` と `baseColorTexture` のみ |
| `metallicRoughnessTexture` 等 | 読まない。出力しない |
| `texCoord` | 0 のみ |
| テクスチャ形式 | PNG（インデックスカラーでも可）。JPEG は避ける（ブロックノイズが CRT 表現と干渉する） |
| 解像度 | 2 の冪。**上限 256×256**（PS2 世代でも 256。実機らしい見えを優先する） |
| フィルタ | ローダでは指定しない。世代プロファイルが決める（FC/SFC/PS1 は nearest、PS2 は linear） |

---

## 8. ポリゴン予算

| 世代 | 予算 | 決定時期 |
|---|---|---|
| PS1 | **フレームあたり 20,000 三角形**（T0-09 で決定） | 決定済み（2026-08-01） |
| PS2 | PS1 の 4 倍（80,000 三角形）を暫定値とする | フェーズ 1 |
| FC / SFC | 3D モデルを量子化して表示するため、シルエットが読めることを優先 | T0-19 の所見 |

PS1 の値の根拠は [measurements/T0-09_ps1_triangle_sort.md](measurements/T0-09_ps1_triangle_sort.md) を参照。
三角形ソート自体は 10 万三角形超まで予算内に収まっており、20,000 は
「最低スペック機で 3〜5 倍遅くても予算内」かつ「第3世代らしい見えを保つ」ための上限である。

---

## 9. エクスポート手順（Blender）

> **検証済み: Blender 5.1.2。**
> 手順は `tools/blender_export_player.py` に**スクリプトとして固定**してある。
> 文章だけで持つと実際の出力とずれても気づけないため、規則の正本はスクリプト側とする。
>
> **対話的な操作（Blender MCP を含む）は、形の探索と確認に使ってよい。
> ただし成果物の正本は必ずスクリプトとする。**
> 対話で作った結果をそのまま `.gltf` として確定させると、
> その形を再現する手段がリポジトリから失われ、「誰も作り直せない成果物」になる。
> 手順は「試す → 決まった値をスクリプトに書く → ヘッドレスで書き出す → 出力を目視する」。
>
> 当たり判定を伴う形（P1-2 の殻）は、**当たり判定もスクリプトから書き出す**
>（`tools/blender_export_shell.py` → `props_shell.plates.json`）。
> 見た目と当たり判定が別々にずれていくのを、テストで機械的に止められる状態にしておく。
>
> ```bash
> /Applications/Blender.app/Contents/MacOS/Blender --background \
>   --python tools/blender_export_player.py
> ```
>
> このスクリプトの出力（`public/assets/models/player.gltf`）を
> `npm run check:assets` が検査するため、「規則どおりに出せば読める」ことが
> CI で機械的に保証される。
>
> なお Blender 5.x では以下が 4.x 以前と異なる（スクリプトは両対応済み）。
> - `Action.fcurves` が無くなり、レイヤ / スロット構造（`action.layers[].strips[].channelbags[]`）になった
> - glTF エクスポータの引数が `export_colors` → `export_vertex_color` に変わった

GUI から手作業で出す場合の対応する設定：

1. オブジェクトを選択して `File → Export → glTF 2.0`
2. **Format**: `glTF Separate (.gltf + .bin + textures)` または `glTF Embedded`
3. **Transform**: `+Y Up` を有効
4. **Data → Mesh**: `Apply Modifiers` を有効、`Tangents` と `Vertex Colors` は無効
5. **Data → Material**: `Export Materials: Placeholder` 以上（baseColor が出れば足りる）
6. **Data → Skinning**: `Export Deformation Bones Only` を有効
7. **Animation**: `Sampling Animations` を有効、`Always Sample Animations` を無効
   （キーフレームを増やしすぎない）。**補間は LINEAR に落とすこと**。
   複数のアニメを出す場合は `Animation Mode: NLA Tracks` にし、トラック名を
   アニメ名にする（Action 名は Blender 4.4 以降のスロット構造で揺れるため）
8. 出力後に `npm run check:assets` を実行し、範囲内であることを確認する

> 本リポジトリのモデルは次のとおり（2D の 2 世代のプレイヤーはモデルではなくスプライト。§11）。
> - `player.gltf` … **ローダとスキニングの検証用モデル**（T1-08、`tools/blender_export_player.py` の実出力）。
>   スキン 5 ボーン、108 三角形、idle / walk / jump の 3 アニメ。
>   アニメーションは NLA トラック経由で書き出し、トラック名をそのままアニメ名にしている。
>   **T2-11 まで第2世代のプレイヤーだったが、第2世代も絵になったのでどの世代からも参照されていない**。
>   `main.ts` の `player` スモークシーンが読んでおり、`check:assets` の対象にも残る
> - `gen3_character.glb` / `gen4_character.glb` … **第3・第4世代のプレイヤーモデル**（T2-07、外部制作）。
>   いずれもスキン 24 ボーン、身長 1.5m、原点は足元。三角形は 495 / 4754 で、
>   世代が上がるほど密になるという見えの差をモデル自身が持つ。
>   **クリップ名はゲーム側と一致しない**（`Idle_4` / `Walking` など）。対応は
>   `generation/profiles.ts` の `player.clips` が持ち、ゲーム側は idle / walk / jump しか知らない。
>   `gen4_character.glb` は待機のクリップを持たないので、歩行の 1 コマ目で止めて立ちポーズにしている
> - `props_*.gltf` … **レベル要素のプロップ**（T1-23、`tools/blender_export_props.py` の実出力）。
>   vine / pedestal / switch / enemy / caster / mark の 6 種、いずれもスキンもアニメも持たない。
>   **すべて [-1, 1] の単位箱の中で作る**（描画側が要素の halfExtents を掛ける）。
>   ツタと敵は交差する 2 枚の板 + アルファ抜きで、形はテクスチャが持つ
> - `test_skinned.gltf` … `tools/make-test-gltf.ts` が生成する最小のスキンメッシュ。
>   ローダの単体テスト（ゴールデン）に使う。Blender に依存せず CI で再生成できる

### 座標系の注意

Blender は **Z が上**、glTF とゲーム側は **Y が上**。
エクスポート時に `+Y Up` を有効にすれば glTF は Y-up で出るが、
**Blender 内でモデルを組む時点では Z を上として作る必要がある**。
`blender_export_player.py` は、ゲーム側の座標で書いた定義を
`to_blender()` で入れ替えてから配置している。

---

## 10. 検査（`npm run check:assets`）

`tools/gltf-preflight.ts` が `public/assets/models/` 以下のすべての `.gltf` / `.glb` を
実際のローダに通し、加えて本書の数値制約を検査する。

| 検査 | 失敗時 |
|---|---|
| ローダで読めること（サブセット適合） | CI 失敗 |
| ジョイント数 ≤ 24 | CI 失敗 |
| ウェイトの合計が 1.0 ±0.01 | CI 失敗 |
| アニメーション補間が LINEAR / STEP | CI 失敗 |
| ファイル名が小文字スネークケース | CI 失敗 |

---

## 11. スプライト（T2-09 / T2-11）

**2D の 2 世代（第1・第2世代）のプレイヤーはモデルではなく絵でできている。**
深度も動的ライティングも持たず、正射影で真横から見るだけの世代では、
ポリゴンを量子化して見せるより、最初から絵として描かれたもののほうが実機の見えに近い。
判断の経緯と実測は [measurements/T2-09_hero_sprite.md](measurements/T2-09_hero_sprite.md)（第1世代）と
[measurements/T2-11_hero_gen2_sprite.md](measurements/T2-11_hero_gen2_sprite.md)（第2世代）。

| 項目 | 規則 |
|---|---|
| 形式 | PNG。**アルファは 0 か 255 のみ**（半透明合成に頼らず、抜きで形を出す） |
| 置き場所 | `public/assets/sprites/` |
| 並べ方 | 正方形のセルを**行優先**で敷き詰めた 1 枚のアトラス |
| 寸法 | §7 と同じく 2 の冪・上限 256×256 |
| セルの大きさ | `cell / PIXELS_PER_WORLD_UNIT` がワールドでの一辺になる。**画素等倍で表示できる値にする**（64px = 2m） |
| 接地線 | **セルの下端**。クリップの中でいちばん深い足がここに来るよう揃える |
| 横位置 | 外接矩形の中心をセルの中心へ揃える（歩いても左右へ滑らないこと） |
| 向き | **右向き**で描く。左を向くときは描画側が左右反転する |
| コマ落ち | **素材が持つ。** ボーンアニメと違い `animationHz` は掛けない（§6 との違い） |
| 面 | **背景とは別の面へ描く**（T2-10 / T2-11）。重ねるのは各世代の量子化パス |
| 色数 | 第1世代はブロックあたり 3 色 + 抜きで、**背景とは取り合わない**。第2世代は画面全体で RGB555 |

> **正本はスクリプト。** 素材（`Docs/hero-gen-N-animations/`）そのものではなく、
> `tools/make-hero-sprite.ts` の出力をアセットとする（§9 の考え方をスプライトにも適用する）。
> 素材を差し替えたら `npm run make:hero-sprite` を走らせ直す。**両世代ぶんが一度に出る。**
>
> - `hero_gen1.png` … **第1世代のプレイヤースプライト**（T2-09、素材は `Docs/hero-gen-1-animations/`）
> - `hero_gen2.png` … **第2世代のプレイヤースプライト**（T2-11、素材は `Docs/hero-gen-2-animations/`）
>
> **並びは 2 枚とも同じ。** 256×256 に 64px のセルが 4×4 で、
> 歩き 6 コマ（セル 0〜5）/ ジャンプ 6 コマ（6〜11）/ 手を前に出す 4 コマ（12〜15）。
> ゲーム側のクリップとの対応は `generation/profiles.ts` の `player.clips` が持つ。
> **世代ごとに処理を分けない**（素材が同じ工程・同じ寸法で作られている）。
>
> 検査は CI のゴールデン（`tests/golden/player_sprite.test.ts`）が行う。
> 絵で描く世代すべてに同じ検査を掛け、寸法・アルファが 2 値であること・接地線・
> 立ち姿の身長が当たり判定と揃うこと・歩きの横位置が揃っていることを見る。

---

## 12. キービジュアル（KV-00）

**画面の外側（DOM）に出す絵**で、GL のテクスチャではない。§7 の制約（2 の冪・上限 256×256・
JPEG を避ける）はテクスチャのための規則なので、ここには掛からない。
唯一そのまま効くのは「非可逆圧縮を使わない」で、理由は違う——
**題字がブロックの絵なので、輪郭がにじむと読めなくなる**（CRT パスとの干渉ではない）。

| 項目 | 規則 |
|---|---|
| 置き場所 | `public/assets/title/` |
| 形式 | PNG（非可逆圧縮を使わない） |
| 寸法 | 横 1280 を上限とする。2 の冪でなくてよい |
| 参照 | `import.meta.env.BASE_URL` からの相対で引く（配布先がサイト直下とは限らない） |

- `key_visual.png` … **開始画面のキービジュアル**。原画は `Docs/console-chaos-title.png`。
  目指す画としての基準でもあり、その読み方は
  [GRAPHICS_KEY_VISUAL_PLAN.md](GRAPHICS_KEY_VISUAL_PLAN.md) が持つ

> 読み込み量（1.6 MB）の最適化は **T4-02（初回ロード時間）** の対象として送っている。
