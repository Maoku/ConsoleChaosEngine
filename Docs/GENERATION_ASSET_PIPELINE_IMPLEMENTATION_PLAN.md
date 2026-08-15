# 世代別アセット生成パイプライン実装計画

作成日: 2026-08-16  
状態: 実装前

## 1. 目的

`ConsoleChaosNazotoki/Docs/ASSET_PIPELINE.md` で確立した、**1つのベース素材から各世代の表現制約に合わせたアセットを生成する仕組み**を、Console Chaos Engineの他のゲームでも再利用できる形へ切り出す。

再利用対象は、単に画像を4種類へ縮小する処理ではない。次の世代差を素材へ焼き込むための共通基盤を対象とする。

- 内部解像度と画角
- 固定パレット、RGB555、truecolor
- 素材単位の色数予算
- 区画単位のパレット切り替え
- 1bit / 8bit alpha
- 座標・タイル格子
- texture filterを前提にした輪郭処理
- 世代ごとの階調、彩度、ディザ

完成後は、次の2つを最初の利用例とする。

1. `ConsoleChaosEngine/apps/console-chaos` の原画から4世代のテクスチャセットを生成する処理
2. `ConsoleChaosNazotoki` の背景・立ち絵アトラス生成処理

## 2. 現状と課題

### 2.1 Nazotoki

Nazotokiには、次の構成で約1,800行の素材処理がある。

- `tools/art/image.mjs`: RGBA画像操作、crop、resample、blit
- `tools/art/matte.mjs`: halo除去、key out、透明領域の切り抜き
- `tools/art/quantize.mjs`: 固定表、median cut、区画パレット、ディザ、alpha量子化
- `tools/art/spec.mjs`: Engineの世代プロファイルとゲーム固有版面の統合
- `tools/art/recipe.mjs`: 背景・立ち絵の調整値
- `tools/build-background-art.mjs`: 背景生成
- `tools/build-portrait-atlas.mjs`: 立ち絵アトラス生成

画像処理、世代能力、ゲーム固有表現が同じツリーにあるため、別ゲームから使うにはコピーが必要になる。

### 2.2 Console Chaos Engine内アプリ

`apps/console-chaos/tools/import-textures.ts` にも、1つの原画から4世代のテクスチャセットを生成する処理がある。

こちらはNazotokiと別に、PNG codec、縮小、色写像、RGB555変換などを実装している。両者の目的は近いが、画像処理の定義と検査方法が共有されていない。

### 2.3 Engineの配布境界

`@console-chaos/engine` はブラウザ向けランタイムであり、現在の配布物には開発ツールや元アセットを含めない。Node.jsのファイルシステム、zlib、CLIをEngine本体へ追加すると、ランタイム境界と配布方針が崩れる。

したがって、画像生成機能はEngine本体ではなく、同じworkspaceに置く独立したNode.jsパッケージとして実装する。

## 3. 基本設計

責務を次の3層へ分ける。

| 層 | 責務 | 正本 |
|---|---|---|
| Engine能力層 | 解像度、パレットモード、区画、alpha、filterなど | `@console-chaos/engine` |
| 共通素材層 | PNG、画像操作、減色、レシピ実行、レポート、検査 | `@console-chaos/asset-pipeline` |
| ゲーム固有層 | 素材ごとの色数予算、版面、アトラス、シーン、意味ベースの色割り当て | 各ゲームの設定と薄いadapter |

### 3.1 新規パッケージ

```text
packages/asset-pipeline/
  package.json
  README.md
  ASSET_RULES.md
  tsconfig.json
  tsconfig.build.json
  src/
    index.ts
    cli.ts
    image/
      types.ts
      png.ts
      geometry.ts
      resample.ts
      matte.ts
    color/
      tone.ts
      palette.ts
      block-palette.ts
      quantize.ts
      dither.ts
    generation/
      spec.ts
    recipe/
      define.ts
      overrides.ts
      runner.ts
      report.ts
    validation/
      image.ts
      outputs.ts
  tests/
    fixtures/
```

パッケージ仕様:

- パッケージ名: `@console-chaos/asset-pipeline`
- 初期バージョン: `0.1.0`
- Node.js 22以上
- ESM only
- `@console-chaos/engine ^0.2.0` をpeer dependencyとする
- TypeScript型定義を配布する
- `console-chaos-assets` CLIを提供する
- `dist`、`README.md`、`ASSET_RULES.md` をtarballへ含める
- Engineランタイムやゲームのブラウザ側コードからはimportしない

## 4. 公開API

### 4.1 画像モデル

共通の画像型を定義する。

```ts
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}
```

PNGは8bit RGB / RGBA、インターレースなしを初期対応範囲とする。範囲外のPNGは黙って変換せず、明示的に失敗させる。

### 4.2 世代別素材スペック

`HARDWARE_GENERATION_PROFILES` から共通能力を取得し、ゲーム側が素材固有値を追加する。

```ts
defineAssetClass({
  id: 'portrait',
  colorBudget: { FC: 4, SFC: 15, PS1: 256, PS2: null },
  targetSize: generation => portraitFrame[generation].cell,
});
```

共通層が導出する値:

- 世代ID
- 内部解像度
- palette mode
- palette block size
- tile snap
- binary alphaかどうか
- RGB555量子化の要否
- texture filter
- Engineの固定マスターパレット

ゲーム側へ残す値:

- 1素材に割り当てる色数
- UI帯やsafe area
- atlas cell寸法
- crop範囲
- 出力ファイル名とURL

`maxSimultaneousColors` は画面全体の能力であり、1素材の色数予算として自動利用しない。

### 4.3 画像処理

初期公開範囲を次に限定する。

- `createImage` / `cloneImage`
- `crop` / `cropToOpaque`
- `blit` / `flipVertical`
- alphaを掛けた色で平均するarea resample
- aspect ratioを保つcover resample
- ブロック内最頻色による縮小
- `trimHalo` / `keyOut`
- tone / gamma / floor / saturation
- RGB555
- median cut
- 固定候補色からのpalette選択
- 区画paletteの構築と適用
- 組織的ディザ
- binary alpha
- 色数、alpha、寸法、palette所属の集計

第1世代の立ち絵で使う「髪・肌・暗部・明部」のような意味判断は共通層へ入れない。palette resolverまたは画素分類callbackをゲーム側から渡せるようにする。

### 4.4 レシピとCLI

ゲーム側は、JavaScriptまたはMJSの設定ファイルからレシピを定義する。

```bash
console-chaos-assets build --config tools/art.config.mjs
console-chaos-assets build --config tools/art.config.mjs --only chapel
console-chaos-assets build --config tools/art.config.mjs \
  --only chapel \
  --set background.tone.FC.saturate=1.9
console-chaos-assets check --config tools/art.config.mjs
```

CLI要件:

- `--only <id>`: 対象素材を限定する
- `--set path=value`: レシピ値を一時的に上書きする
- `--out-dir <path>`: 試行出力を製品アセットと分離する
- `--dry-run`: 入出力と適用スペックだけを表示する
- `check`: 出力を書き換えず、再生成結果またはmanifestと比較する
- 未知の設定パス、世代、素材IDはエラーにする
- `--set` で全件を上書きする場合は、明示的な許可flagを要求する
- 書き込み前に全入力とレシピを検証し、途中まで更新された状態を作らない

## 5. 生成レポート

生成ごとに決定論的なmanifestを出力する。

記録項目:

- pipeline package version
- Engine versionまたは世代プロファイルdigest
- source pathとSHA-256
- recipe digest
- generation ID
- 出力パス
- width / height
- visible color count
- alpha mode
- palette modeとpalette count
- palette block size
- decode後RGBAのSHA-256

時刻や絶対パスは含めない。同じ入力とレシピなら、別環境でも同じmanifestになることを要件とする。

## 6. 共通化の境界

### 6.1 共通パッケージへ移す

- PNG codecとRGBA画像型
- crop、blit、resize、反転などの画像操作
- matteとhalo処理
- tone処理
- 固定palette、median cut、RGB555
- 区画paletteとディザ
- binary alpha
- recipe overrideとCLI引数処理
- generation profileからの共通スペック導出
- 汎用的な画像検査と決定論的レポート

### 6.2 Nazotokiへ残す

- `portrait` / `background` の具体的なレシピ値
- UI帯の高さと色
- 立ち絵セル寸法とbaseline
- 胸像の切り出し方法
- 顔の実測範囲
- `lean`と表情描画
- アトラスのセル配置
- シーンIDとゲームmanifest
- FC立ち絵の意味ベースpalette
- 動的な光源と影のゲームルール

### 6.3 Console Chaosアプリへ残す

- `TextureSpec`
- FCの意味paletteとキー色
- ツタを綱へ合わせる回転と周期移動
- ハートglyphの合成
- 世代別の作品固有tone
- シームレス性、直線性、色系統などゲーム固有検査
- マテリアル、レベル、謎との参照整合性

## 7. ルール文書

`packages/asset-pipeline/ASSET_RULES.md` を共通規則の正本とし、tarballへ含める。

最低限、次を規定する。

1. ベース素材は1つでよいが、全世代への単純な同一縮小は禁止する。
2. 世代差は、解像度、色空間、色数、区画、alpha、格子など実際の能力制約から作る。
3. ハードウェア能力値をゲームのレシピへ書き写さない。
4. 素材単位の予算とレイアウトはゲーム側へ置き、根拠をコメントまたは文書に残す。
5. 数値はレシピ、処理順はbuilderに置く。
6. 足りない姿勢・表情を既定動作として推測生成しない。
7. 動く光、影、合成など実行時に意味を持つ表現を素材へ焼き込まない。
8. 原画、レシピ、出力の対応をmanifestで追跡できるようにする。
9. 未知の設定や未対応形式を黙って無視しない。
10. 寸法だけでなく色数、alpha、palette、区画、ランタイム配置との一致をCIで検査する。
11. 新しい汎用処理は、少なくとも2つの実利用または明確な次の利用先がある場合だけ追加する。
12. 目視確認が必要な品質と、CIで機械検査できる制約を区別する。

Nazotokiの `Docs/ASSET_PIPELINE.md` は、共通規則への参照と作品固有レシピの説明を残す。工程の一般原則を二重管理しない。

## 8. 実装フェーズ

### P0: 現行出力の固定

作業:

- Nazotokiの背景・立ち絵を現行ツールで全件再生成する
- Console Chaosの4世代テクスチャを現行ツールで全件再生成する
- decode後RGBAのhash manifestを保存する
- 寸法、色数、alpha、palette数、現在のCLIレポートを保存する
- 通常の生成コマンドでGit差分が出ないことを確認する

完了条件:

- 移行前後を画素単位で比較できる
- 現状の意図しない非決定性がない

### P1: パッケージ基盤

作業:

- `packages/asset-pipeline` を追加する
- package build、型定義、unit testを構成する
- rootのlint、test、buildへ追加する
- package boundary検査へasset-pipelineの規則を追加する
- Engine本体からasset-pipelineへの依存がないことを検査する

完了条件:

- 空のconsumerからpackage APIをimportできる
- Engineのbrowser bundleとruntime dependencyが変化しない

### P2: 画像・減色処理の移植

作業:

- 2つのPNG実装を比較し、対応形式とエラー条件を統合する
- Nazotokiのimage、matte、quantizeを型付きで移植する
- Console Chaosの最頻色縮小を移植する
- 世代スペック導出APIを実装する
- 小さいfixtureによるunit testを追加する

完了条件:

- alpha付きresample、halo、固定palette、RGB555、区画paletteがfixtureで検証される
- 移植した各処理が現行実装と同じRGBAを返す

### P3: レシピrunner、CLI、文書

作業:

- `defineAssetPipeline`、recipe override、runnerを実装する
- `build`、`check`、`dry-run`を実装する
- manifestとRGBA hashを実装する
- `README.md`、`ASSET_RULES.md`、設定templateを追加する
- unknown keyと部分書き込みを防ぐtestを追加する

完了条件:

- fixture projectで1つの原画から4世代を生成できる
- 同じ処理を2回実行したmanifestが一致する
- `check`が差分あり／なしを正しく返す

### P4: Console Chaosアプリで先行利用

作業:

- `apps/console-chaos/tools/png.ts` の利用箇所を共通packageへ移す
- `import-textures.ts` の最頻色縮小、共通画素操作、RGB555を共通APIへ移す
- ゲーム固有のpalette写像、glyph、rope処理はadapterとして残す
- `check-textures.ts` の汎用検査だけを共通APIへ置換する
- 旧実装と新実装のRGBA hashを比較する

完了条件:

- 全4セットが移行前と画素一致する
- 既存のゲーム固有asset検査がすべて通る
- 共通packageにConsole Chaos固有の素材名や謎ルールがない

### P5: Nazotoki移行

作業:

- asset-pipeline tarballをNazotokiのdevDependencyへ追加する
- `tools/art.config.mjs` に素材一覧、予算、版面を集約する
- `build-background-art.mjs` を背景adapterへ縮小する
- `build-portrait-atlas.mjs` を立ち絵adapterへ縮小する
- `npm run art`、`portrait`、`bg` のコマンド互換を維持する
- `tests/art-spec.test.ts` を共通スペックとゲーム配置の契約testへ更新する
- 画素一致後に重複した共通モジュールを削除する

完了条件:

- 全背景・全立ち絵が移行前と画素一致する
- Engine profileとゲーム版面の不一致をCIで検出できる
- Nazotoki固有の顔、姿勢、UI、シーンが共通packageへ入っていない

### P6: 配布とCI統合

作業:

- `tools/pack-distribution.mjs` にasset-pipelineを追加する
- `tools/verify-distribution.mjs` にCLIと型定義のconsumer smoke testを追加する
- `Docs/DISTRIBUTION.md` に3つ目のtarballを追記する
- root `verify` にasset-pipelineのlint、test、buildを含める
- Nazotoki CIに `console-chaos-assets check` を追加する
- release notesとSHA-256一覧を更新する

完了条件:

- `npm run verify` が通る
- `npm run verify:distribution` が隔離consumerで通る
- Nazotokiの `npm run ci` が通る
- 配布tarballだけを使って別projectから生成できる

## 9. テスト計画

### 9.1 Unit test

- PNG RGB / RGBA decodeとencode round-trip
- 未対応bit depth、color type、interlaceの拒否
- premultiplied alpha resampleで透明画素のRGBが輪郭へ滲まないこと
- cover cropの縦横比と中心位置
- 最頻色縮小のtie-breakが決定論的であること
- `trimHalo` が白いマットを除去し、彩度のある明部を残すこと
- RGB555の境界値
- fixed paletteの選択数と所属
- block paletteの区画割り当て
- binary alphaとディザ
- `--set` の型変換、unknown path拒否
- 同一入力から同一reportが得られること

### 9.2 契約test

- generation IDの並びがEngineと一致する
- width、height、palette block、filterがEngine profileから導出される
- alpha能力がtranslucency profileと一致する
- 素材予算がゲーム側の宣言からのみ取得される
- NazotokiのUI帯と立ち絵セルがランタイム定義と一致する
- Console Chaosのtexture setが世代設定と一致する

### 9.3 Golden / parity test

PNGファイルの圧縮バイトではなく、decode後RGBAを比較する。codecの圧縮方式を変更しても絵が同じならparityとみなせるためである。

比較対象:

- Nazotokiの全背景
- Nazotokiの全立ち絵atlas
- Console Chaosの全世代texture set
- 色数、alpha、寸法、palette countのreport

意図した出力変更を行う場合は、本共通化とは別changeとして扱い、理由と目視比較を記録する。

## 10. 受け入れ条件

- 1つのベース素材から4世代の異なる制約を適用できる
- NazotokiとConsole Chaosアプリの2consumerが同じpackageを実利用している
- ハードウェア解像度、palette block、alpha能力をゲーム側へ重複定義していない
- 素材ごとの色数予算と版面はゲーム側に残っている
- 共通packageにゲーム固有の人物、シーン、謎、URLが含まれない
- 同一入力とレシピから決定論的な出力とmanifestが得られる
- 移行対象の生成物がdecode後RGBA単位で移行前と一致する
- Engineのbrowser bundle sizeとruntime dependencyが増えない
- package単体、Engine workspace、Nazotokiの全検証が通る
- 配布tarballから別projectでCLIを利用できる

## 11. スコープ外

初期実装では次を行わない。

- 任意形式に対応する汎用画像処理framework
- JPEG、GIF、WebP、interlaced PNGへの対応
- AIによる原画、表情、姿勢の生成
- ゲーム固有atlas layoutの自動推測
- runtime lighting、shadow、animationの素材への焼き込み
- glTFや音声の世代別変換
- 既存アセットの見た目改善
- 画素parityを崩すアルゴリズム変更

これらは、2つ以上の実利用と検証方法が明確になった時点で別フェーズとして検討する。

## 12. 実装順序の原則

2つのリポジトリは別々に配布・依存管理されるため、次の順序を守る。

1. Engine repository内で共通packageと検証を完成させる
2. Engine内のConsole Chaosアプリを最初のconsumerとして移行する
3. asset-pipeline tarballを作成・検証する
4. NazotokiへdevDependencyとして導入する
5. Nazotokiの画素parityを確認する
6. 最後に各consumerの重複コードを削除する

共通packageを先に作り、consumerの旧実装をparity oracleとして残すことで、移行途中でも正しさを比較できる状態を維持する。
