# Asset Pipeline Sample 実装計画

参照: [PLAN.md](PLAN.md)

作成日: 2026-08-16

状態: ImageGen変換元frameへの修正計画を策定済み（実装修正は未着手、2026-08-16）

> **適合性メモ:** 2026-08-16に完了したP5/P6は、単一の `character-upper.png` をコードで
> shear / warpして揺らしと目パチを生成している。この経路は「ImageGenでアニメーション状態ごとの
> 変換元画像を `art/source` に用意し、そこから各世代へ変換する」という本サンプルの要件を満たさない。
> 現行生成物は暫定扱いとし、P9〜P12で置き換える。

## 1. 目的

`@console-chaos/asset-pipeline` の最小かつ実用的なサンプルとして、ImageGenで用意した
世代非依存のアニメーション変換元画像から `FC / SFC / PS1 / PS2` の能力差に沿った画像を生成し、
Console Chaos Engine 上のタイトル画面で表示する。

完成物は次を同時に示す。

- ImageGenで用意した世代非依存のロゴと、姿勢・ポニーテール・目の状態が描かれたframe原画を入力にする
- 世代別画像は手作業せず、必ず `@console-chaos/asset-pipeline` から生成する
- asset pipeline は Node.js の build-time tool に閉じ、ブラウザコードから import しない
- Engine の世代プロファイル、世代切替、世代別 renderer を利用する
- 第1・第2世代はImageGen由来の離散姿勢画像、第3・第4世代は同じkey poseとTweenで左右へ揺らす
- ポニーテール揺れと目パチはコード変形ではなく、ImageGen由来のframe差分で表現する
- 同一の楽曲データをEngineの世代別音源・同時発音数へ編曲し、体揺れと拍を同期する

## 2. スコープ

### 2.1 実装対象

- 1画面だけのタイトル画面
- `Console Chaos Engine` のタイトルロゴ
- [character.png](character.png) のキャラクターを元にした上半身のImageGen変換元frame
- ロゴ1種と、姿勢3種×目3種のキャラクター変換元frameから作る4世代出力
- FC/SFCの画像パターン切替、PS1/PS2のTween
- ポニーテール揺れと目パチアニメーション
- 世代別の音声能力に沿ったタイトルBGM
- キーボード／ゲームパッドによる世代切替
- asset生成、決定性、runtime配置、アニメーションの自動検査
- 4世代の目視確認

### 2.2 スコープ外

- ゲーム本編、タイトル決定後の遷移、効果音
- FC / SFC / PS1 / PS2専用の完成画像をImageGenで直接生成すること
- 変換元frameをコードのshear / warpで代替すること
- glTF、動画、音声の変換
- asset pipeline 共通パッケージへのゲーム固有機能の追加
- DOM/CSSだけでロゴを代替すること
- runtimeで原画を動的変換すること

## 3. 先に固定する設計判断

### 3.1 ImageGen変換元frameをasset IDごとに用意する

pipelineが実際に入力する原画は次の10枚とする。

| 素材ID | 変換元画像 | 用途 |
|---|---|---|
| `title-logo` | `art/source/title-logo.png` | 正確に `Console Chaos Engine` と読める透過ロゴ |
| `character-{left\|center\|right}-{open\|half\|closed}` | `art/source/character-{left\|center\|right}-{open\|half\|closed}.png` | 3つの揺らし・ポニーテール状態と3つの目状態を組み合わせた9枚の透過key pose |

`art/source/character-upper.png` は同一キャラクターを維持するための参照anchorとして残すが、
修正後のcharacter assetを直接変換する入力にはしない。既存ファイルを上書きせず、9枚を新しい兄弟fileとして追加する。

9枚はbuilt-in ImageGenのidentity-preserve編集で作成する。最初に `Docs/character.png` と
`art/source/character-upper.png` を `view_image` で目視し、参照画像の役割を
「character identity / composition anchor」と明記する。その後、次の順で
1 asset variantにつき独立したImageGen callを1回以上行い、複数variantを1回のbatch生成で代替しない。

1. `left / center / right` の開眼key poseを個別に生成する
2. 各開眼key poseを参照し、姿勢、髪、衣装、canvas配置を変えず `half / closed` を個別に生成する
3. 各採用出力を生成先から `art/source` へ保存し、採否を目視確認する。不採用出力や既存assetを上書きしない

全callで、同一人物、猫耳、髪色、ポニーテール、顔、衣装、配色、上半身構図、canvas寸法、
下端中央pivot、透明背景を不変条件として繰り返す。変えてよいのは指定した体の揺れ、
それに遅れて動くポニーテール、目の開きだけとする。左・中央・右は世代名ではなく、
全世代で共有するanimation key poseである。

ImageGenの最終prompt、参照画像とその役割、出力file、採用理由、却下理由、SHA-256、
canvas寸法、alpha有無を `Docs/ASSET_PROVENANCE.md` に記録する。`fc` などの世代名やpixel-art化を
promptへ含めず、世代差は必ずasset pipelineで付与する。ImageGenが真正のalphaを返さなかった場合は、
被写体と重ならない均一key背景かを記録し、その場合だけpipelineの `keyOut()` を使用する。

### 3.2 世代別画像の唯一の生成経路

`tools/art.config.mjs` を変換定義の正本とし、次の経路だけを許可する。

```text
ImageGen変換元frame（asset IDごと）
  -> @console-chaos/asset-pipeline
     -> crop / matte / resample
     -> tone / palette / RGB555 / alpha量子化
     -> FC・SFC・PS1・PS2 PNG
     -> deterministic asset-manifest.json
  -> @console-chaos/engine の世代別rendererで表示
```

生成済みPNGの手修正は禁止する。見た目を調整するときは、原画、crop、recipe、builderのいずれかを変更して
全世代を再生成する。`console-chaos-assets check` をCIで実行し、生成後の手修正を検出する。

### 3.3 アニメーションはruntime責務

左右への揺れは世代の能力に応じて2つの経路へ分ける。どちらも同じ9枚のImageGen変換元frameを使い、
世代別frameをImageGenや画像編集ソフトで直接制作しない。

| 世代 | 動作 | サンプリング | 角度 |
|---|---|---:|---:|
| FC | pipelineで生成した `左 → 中央 → 右 → 中央` の画像パターン切替。runtime回転なし | profileの6 Hz | 見かけ±5°相当 |
| SFC | pipelineで生成した `左 → 中央 → 右 → 中央` の画像パターン切替。runtime回転なし | profileの12 Hz | 見かけ±5°相当 |
| PS1 | ImageGen key poseを使い、poseに焼き込まれた角度を差し引いたresidualをease-in-out Tween | profileの30 Hz | 合成結果±5° |
| PS2 | ImageGen key poseを使い、poseに焼き込まれた角度を差し引いたresidualをease-in-out Tween | profileの60 Hz | 合成結果±5° |

1往復は1秒とし、全世代で拍の位置は共有する。PS1/PS2だけ周期や振幅を変えるのではなく、
同じ位相に対する補間方法とサンプリング密度だけを変える。

`left / center / right` は、下端中央を揃えつつ肩、髪、ポニーテールの輪郭が実際に異なるImageGen key poseとする。
コードでshearや局所warpを作ってはならない。各poseに見かけ上焼き込まれた基準角を
`authoredPoseAngle`（初期値 `-5° / 0° / +5°`）として宣言し、PS1/PS2のruntime回転は
`tweenTargetAngle - authoredPoseAngle` のresidualだけを適用する。これによりsource poseとTweenの二重傾斜を防ぐ。

PS1/PS2の回転中心は画像中央ではなく上半身の下端中央とする。`SpriteCommand` 自体は中央回転なので、
下端中央をpivotとして回したときのsprite中心を毎frame計算し、腰が横滑りしないようにする。
実装時は実画像を目視して `authoredPoseAngle` を調整し、最終的な端点が±5°相当を超えないことをcaptureで確認する。

### 3.4 ポニーテールと目パチもpipeline出力にする

キャラクターframe IDは `character-{left|center|right}-{open|half|closed}` の9種とし、
各IDを同名のImageGen変換元PNGへ1対1で対応させる。

- `left / center / right` は体の揺れと、体に対して遅れて見えるポニーテールをImageGen出力内に描く
- `open / half / closed` はImageGenで描き分け、コードの縦方向warpで代替しない
- 9枚は同じcanvas、crop、下端pivotを持ち、frame切替時に全体が跳ねないようにする
- 顔、猫耳、前髪、衣装、手、輪郭のうち指定箇所以外が変化した出力は採用しない
- FC / SFC / PS1 / PS2はすべて同じ9枚を入力とし、世代ごとのImageGen画像を追加しない
- blink周期は3秒とし、FCは開閉2frame、SFC以降は半閉じを含むframe列をprofileのanimation Hzでsampleする
- reduced motionでは体とポニーテールを中央に固定するが、目パチは停止しない

9種はそれぞれ異なるsource hashと同じ変換recipeを持つ。FCの全frameは共通の16色paletteを使い、frame切替で
画面全体の色数が増えないようにする。source画像間の差はImageGen由来、世代出力間の差はpipeline由来として
manifestとprovenanceの両方から追跡できるようにする。

### 3.5 BGMは同一Scoreを世代能力で編曲する

`src/audio.ts` に120 BPM、4/4拍子、4小節ループの明るいタイトル曲を `Score` として定義する。
体揺れは1秒で1往復とし、左右の端点が120 BPMの各beatへ一致する。

世代差は世代IDの直接分岐ではなく `HardwareGenerationProfile.audio` から導出する。

| 能力 | 編曲 |
|---|---|
| 5 channels | lead / bass / percussionの基本3part |
| 8 channels以上 | 2音のpadを追加 |
| 24 channels以上 | harmonyを追加 |
| 48 channels以上 | 高域のaccentを追加 |

再生には `createGenerationAudioService()` を使用するため、profileの `psg / brr / adpcm / streaming`、
sample rate、reverb、positional能力がEngine側で適用される。世代切替時は曲を再開せず `useScore()` で
編曲だけを差し替え、loop内のtick位相を維持する。ブラウザのautoplay制限には `installAudioUnlock()` で対応し、
Web Audioを作れない環境では `createNullAudioService()` へfallbackする。

## 4. 完成条件

### 4.1 画面

- 画面上部中央に `Console Chaos Engine` のロゴが表示される
- キャラクターの上半身が画面下端中央に接して表示される
- ロゴと顔が重ならず、耳、髪、顔、襟、腕の主要輪郭が欠けない
- 4世代とも同じ構図、同じキャラクター、同じ拍位置を保つ
- FC/SFCはruntimeのrotationを使わず、画像の輪郭が変わる3姿勢を切り替える
- PS1/PS2は下端pivotを保ったままTweenで滑らかに傾く
- ポニーテールが体とは異なる位相で揺れ、3秒周期で自然に目パチする
- 背景は単色を基本とし、第1世代の同時色数を不必要に消費しない
- transition中は旧世代と新世代の両方が正しい画像と動作で合成される

### 4.2 操作

- `1 / 2 / 3 / 4` で `FC / SFC / PS1 / PS2` を直接選べる
- `Q / E` またはゲームパッドのshoulderで前後の世代へ切り替えられる
- `?generation=FC|SFC|PS1|PS2` で初期世代を固定できる
- OSの `prefers-reduced-motion` が有効な場合は角度を0°に固定できる
- 最初のpointerまたはkeyboard操作でBGMのWeb Audioをunlockできる

### 4.3 asset

- production入力10枚（ロゴ1枚＋character key pose 9枚）から計40枚の世代別PNGが生成される
- 9つのcharacter asset IDがそれぞれ同名のImageGen変換元PNGをsourceとして持つ
- 全出力が `asset-manifest.json` に source hash、recipe hash、世代、寸法、色数、alpha mode とともに記録される
- FCのロゴと全キャラクターframeの色集合が20色以下で、単色背景を加えても25色以内に収まる
- FC出力は固定54色だけ、SFC出力はRGB555、FC/SFC/PS1はbinary alphaになる
- PS2は原画の滑らかなalphaを保持できる
- 同じ入力とrecipeで再生成したdecode後RGBAとmanifestが一致する

### 4.4 audio

- 120 BPMのbeatと体揺れの左右端点が一致する
- 全世代でテンポ、拍子、loop長、旋律を共有する
- `profile.audio.channels` に応じて3 / 4 / 5 / 6 track相当へ段階的に編曲する
- 世代切替時に再生tickをresetせず、Engineの世代別音源へ切り替わる
- AudioContextを利用できないテスト・制限環境でもアプリ全体は動作する

### 4.5 boundary

- `src/**` は `@console-chaos/asset-pipeline` をimportしない
- `tools/**` だけが `@console-chaos/asset-pipeline` を利用する
- ブラウザbundleへNode.js API、asset pipeline、原画、provenance文書を含めない
- Engineとasset pipelineはpackage rootからのみimportする

## 5. 配置計画

```text
apps/asset-pipeline-sample/
  Docs/
    PLAN.md
    IMPLEMENTATION_PLAN.md
    ASSET_PROVENANCE.md
    character.png
    captures/
      title-fc.png
      title-sfc.png
      title-ps1.png
      title-ps2.png
  art/
    source/
      title-logo.png
      character-upper.png  # identity / composition参照anchor（変換入力外）
      character-left-open.png
      character-left-half.png
      character-left-closed.png
      character-center-open.png
      character-center-half.png
      character-center-closed.png
      character-right-open.png
      character-right-half.png
      character-right-closed.png
  public/
    assets/generated/
      fc/title-logo.png
      fc/character-{left|center|right}-{open|half|closed}.png
      sfc/title-logo.png
      sfc/character-{left|center|right}-{open|half|closed}.png
      ps1/title-logo.png
      ps1/character-{left|center|right}-{open|half|closed}.png
      ps2/title-logo.png
      ps2/character-{left|center|right}-{open|half|closed}.png
      asset-manifest.json
  src/
    actions.ts
    animation.ts
    app.ts
    audio.ts
    bootstrap.ts
    render-manifest.ts
    style.css
  tests/
    animation.test.ts
    asset-contract.test.ts
    lifecycle.test.ts
    render-frame.test.ts
  tools/
    art.config.mjs
    check-assets.ts
  index.html
  package.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
  vitest.config.ts
```

`art/source` はViteの `public` 配下へ置かず、製品bundleから除外する。runtimeが読むのは
`public/assets/generated` だけとする。

## 6. asset pipeline 設計

### 6.1 asset class

Engineの `HARDWARE_GENERATION_PROFILES` からpalette mode、palette block、tile snap、alpha、filterを導出し、
サンプル側は版面と素材単位の色数だけを宣言する。

#### タイトルロゴ

| 世代 | 出力寸法 | 色数上限 | 根拠 |
|---|---:|---:|---|
| FC | 200×40 | 4 | 横幅256pxの約78%。文字輪郭を優先し、画面色数を温存する |
| SFC | 200×40 | 12 | 同じ版面でRGB555の色差を見せる |
| PS1 | 250×50 | 32 | 横幅320pxの約78%。nearest filterでも文字を保つ |
| PS2 | 500×100 | 制限なし | 横幅640pxの約78%。linear filterとsoft alphaを利用する |

#### キャラクターframe（9 asset IDで共通）

| 世代 | 出力寸法 | 色数上限 | 根拠 |
|---|---:|---:|---|
| FC | 120×144 | 16 | 背景とロゴを含めても同時25色以内に置く |
| SFC | 130×156 | 48 | 顔、髪、衣装の階調をRGB555内で増やす |
| PS1 | 150×180 | 96 | 320×240内で上半身を大きく保ちつつ減色差を残す |
| PS2 | 280×336 | 制限なし | 640×448内で75%の高さ。原画に最も近い基準出力にする |

寸法は初期値として固定し、変更する場合は4世代の画面占有率とロゴとの間隔を再計測する。
単純に同じ画像を4倍率で縮小するのではなく、各世代の画面解像度に対する占有率を揃える。

### 6.2 recipe

`tools/art.config.mjs` の `recipe` は次だけを持つ。

- 素材ごとのcrop範囲またはopaque boundsのpadding
- key colorを使う場合の `tolerance / isolatedTolerance / fringe`
- 世代別の `gamma / floor / saturation`
- 世代別の `dither / spread`
- 世代別のalpha threshold

初期方針は次とする。

- FC: ディザなし、輪郭優先、固定master paletteから選択
- SFC: 必要な場合だけ弱いordered dither、最終値をRGB555へ量子化
- PS1: 96色／32色へ減色し、nearest filterで読める輪郭を残す
- PS2: 色数制限なし、soft alphaを保持

調整は `--only`、`--generation`、`--set`、`--out-dir build/art-trial` を使い、
試行出力で決めた値だけをrecipeへ戻す。製品PNGを画像編集ソフトで修正しない。

### 6.3 builderの処理順

ロゴとキャラクターで同じ共通処理を使い、意味の違うcrop/matteだけを素材IDで選ぶ。

1. 入力PNGをdecodeする
2. 必要な場合だけ `keyOut()` で均一背景を透明化する
3. 9つのcharacter sourceが同じcanvas寸法、下端pivot、許容boundsに入ることを検査する
4. 共通のcrop矩形とpaddingで正規化する。frameごとの自動cropで中心をずらさない
5. 出力と同じ縦横比へ中央cropする
6. `resample()` で世代別寸法へ縮小する
7. `applyTone()` でrecipeの階調と彩度を適用する
8. canonicalな中央・開眼frameを基準に共通paletteを作り、同じ世代の全frameへ適用する
9. `applyPalette()` でpalette、ディザ、alpha thresholdを適用する
10. `BuiltAsset.paletteCount` と画像をrunnerへ返す
11. runnerの共通検査を通してPNGとmanifestを書き出す

builderには姿勢、ポニーテール、目を作る `motionWarp`、`blinkWarp`、shear、同等のpixel変形処理を置かない。
builderの責務はImageGen変換元frameに同じ世代変換を適用することに限定する。

縦横比調整、palette resolverなどゲーム固有の薄い処理は `art.config.mjs` に置く。
再利用先が1つしかない処理を `packages/asset-pipeline` へ追加しない。

### 6.4 出力URLとmanifest

asset pipelineの `asset-manifest.json` はbuild追跡用であり、ブラウザrendererの
`RenderAssetManifest` とは別の契約として扱う。

`src/render-manifest.ts` は40枚の生成済みURLを `textures` へ登録し、世代別・姿勢別・目frame別のURL表を
`defineGenerationVariant()` で公開する。全spriteはtextureを明示するため、
`fallbackTextures` はrenderer契約を満たす保険として各世代のロゴURLを指定する。

## 7. runtime 設計

### 7.1 起動

`bootstrap.ts` は次の順序で公開Engine APIだけを組み立てる。

1. `#screen` canvasを取得する
2. URLから初期世代を検証する。未知値は `FC` へfallbackする
3. `createAssetManager()` と `createGenerationWebGlRenderer()` を作る
4. `createGenerationAudioService()` を作り、失敗時はnull serviceへfallbackする
5. `createKeyboardGamepadSource()` と `createGameHost()` を作る
6. `createTitleModule()` を開始し、audio unlockを登録する
7. resize、pagehide、reduced-motion、audio unlockのlistenerを登録・解放する

canvasの表示サイズはCSSで縦横比を維持する。描画bufferは外側表示用の固定サイズにし、
各世代の内部解像度、palette、filter、CRTはrendererへ任せる。

### 7.2 GameModule

`app.ts` はタイトル画面だけを持つ `GameModule` とする。

- `prepareFixedUpdate`: action mapをsampleし、世代切替を要求する
- `fixedUpdate`: 共通のanimation timeを加算する
- `buildRenderFrame`: 4世代ぶんのgeneration mask付きcommandを積む
- `dispose`: action stateとlistenerを解放する

描画時は `GENERATION_IDS` を走査し、各世代について次を積む。

1. `generations: [generation]` を持つ単色background
2. 画面上部中央のscreen-space logo sprite
3. animation stateに対応するtextureを使った下端中央pivotのscreen-space character sprite

現在世代だけをapp側で選ばず4世代のcommandを同居させる。これにより、Engineのtransition中に
`renderGenerations()` が旧・新2世代を描く場合も、それぞれ正しい画像と角度を取得できる。

### 7.3 アニメーション関数

`animation.ts` はDOMやEngine hostへ依存しない純粋関数として実装する。

```ts
titleAnimationFrame(profile, timeSeconds, reducedMotion): {
  angle: number;
  pose: 'left' | 'center' | 'right';
  authoredPoseAngle: number;
  eyes: 'open' | 'half' | 'closed';
}
pivotedSpriteCenter(pivot, size, angle): readonly [number, number]
```

世代IDの `if` を散らさず、`defineGenerationVariant()` で次を網羅定義する。

- `mode: 'step' | 'tween'`
- `sampleHz`（profileの `video.animationHz` と一致）
- `amplitudeRadians`
- `authoredPoseAngle`
- `cycleSeconds`
- step patternまたはeasing
- blink frame sequence

Tweenは左右の端で速度が0になる `smoothstep` または同等のease-in-outを使う。
PS1は1/30秒、PS2は1/60秒へ時刻を量子化してから補間する。
低世代は補間値を計算せず `rotation: 0` のまま、ImageGen画像パターンを直接返す。
PS1/PS2はImageGen key poseを選び、runtimeへ渡す角度を
`tweenTargetAngle - authoredPoseAngle` とする。key pose内の揺れを消さず、剛体回転だけが二重にならないようにする。
ポニーテールの遅れは画像内のkey pose差として持たせ、runtimeはframe順序だけを制御する。

### 7.4 screen-space配置

配置値は各 `HardwareGenerationProfile.video.internalWidth / internalHeight` から求める。

- logo中心X: `internalWidth / 2`
- logo上端: 8px
- character pivot X: `internalWidth / 2`
- character pivot Y: `internalHeight`
- characterのorder: logoより後、PS1 ordering tableではscreen-space既定slot 10を使用

固定の640×448座標を4世代へ使い回さない。表示サイズはasset classと同じ世代表に置き、
テストで全矩形が内部解像度に収まることを検査する。

## 8. テスト計画

### 8.1 asset contract

`tests/asset-contract.test.ts` と `tools/check-assets.ts` で次を検査する。

- `console-chaos-assets check` が差分なしで成功する
- asset IDは `title-logo` と9つの `character-*` だけである
- 各assetに4世代の出力があり、計40枚である
- manifestのsource pathが `art/source/title-logo.png` と9つの同名character sourceを指す
- 9つのcharacter asset IDとsource pathが1対1であり、`character-upper.png` を変換入力として再利用しない
- 9つのcharacter source hashが一致せず、provenanceのSHA-256とmanifestのsource hashが対応する
- 寸法、visible color count、palette mode、alpha modeが§6.1の契約と一致する
- FCの全可視RGBがEngineのmaster paletteに所属する
- SFCの全可視RGBがRGB555で表現できる
- FCのロゴと全キャラクターframeの色集合の和が20色以下である
- 透明画素のRGBがclear blackへ正規化されている
- 全character frameのopaque boundsが空でなく、意図しない四辺の切れがない
- sourceとFC/SFC出力のleft/center/rightがdecode後RGBAで異なる
- sourceと全世代出力のopen/half/closedがdecode後RGBAで異なる
- `art.config.mjs` に姿勢、ポニーテール、目を合成するwarp / shear処理が残っていない
- 2回のbuildで2回目に書き込みが発生せず、Git差分も増えない

### 8.2 unit test

`tests/animation.test.ts`:

- FC/SFCのruntime角度が常に0°である
- FC/SFCのposeが `left / center / right` の宣言パターンだけを取り、sample区間内で変化しない
- PS1/PS2はsourceの `authoredPoseAngle` とruntime residualの合成結果が端点で±5°となり、中間で単調に補間する
- pose切替時にruntime residualが焼き込み角を相殺し、二重傾斜や角度の不連続を作らない
- 同じ時刻のPS1/PS2が同じ方向を向く
- blinkが3秒周期で `open / half / closed` の世代別frame列を取る
- ポニーテールの遅れを含むImageGen pose frameが宣言順で選択される
- pivot補正後も画像下端中央が1px以内で固定される
- reduced-motionでは全世代0°になる

`tests/render-frame.test.ts`:

- 各世代にbackground、logo、選択中character frameが1つずつ存在する
- commandのgeneration maskとtexture URLが対応する
- logoとcharacterが内部解像度内に収まり、互いの主要領域が重ならない
- spriteが `screenSpace: true` で、atlasや世代外textureを参照しない

`tests/audio.test.ts`:

- Scoreが120 BPM、4/4、4小節で決定的にloopする
- 編曲track数がchannel能力に応じて単調増加する
- FC編曲の最大同時発音数が5を超えない
- GameModule開始時にBGMを再生し、世代切替では位相をresetせずscoreだけを差し替える

### 8.3 lifecycle test

`@console-chaos/engine-testkit` のmanual loop、mutable input、recording rendererを使う。

- moduleを開始し、固定tick後にrender frameが作られる
- `Digit1..4` で4世代を順に切り替えられる
- transition中は旧・新世代のcommandが両方存在する
- timeは世代切替後も連続し、アニメーション位相がresetされない
- audio source profileと編曲が世代切替に追従する
- `dispose()` を複数回呼んでもresourceが残らない

### 8.4 目視確認

同じcanvasサイズ、同じanimation位相で4世代をcaptureし、`Docs/captures` に保存する。

| 観点 | FC | SFC | PS1 | PS2 |
|---|---|---|---|---|
| ロゴ可読性 | 固定paletteでも全文を読める | RGB555で色崩れなし | nearestで輪郭が明瞭 | soft edgeが滲まない |
| 顔 | 目・口・猫耳を識別できる | 髪と肌が分離する | 細線がノイズ化しない | 原画に最も近い |
| alpha | 白縁・色縁が目立たない | 同左 | 同左 | soft edgeが背景となじむ |
| motion | ImageGen key poseの明確なコマ切替 | ImageGen key poseの明確なコマ切替 | key pose＋30 Hz residual Tween | key pose＋60 Hz residual Tween |
| layout | 下端pivot固定 | 同左 | 同左 | 同左 |

白背景と暗背景の両方で一時確認し、haloが暗背景でだけ見つかる問題を防ぐ。

## 9. 実装フェーズ

P0〜P8は履歴として完了済みだが、P5/P6のsource設計は本書冒頭の適合性メモにより置換対象である。
修正はP9〜P12で行い、各フェーズを独立したcommitにする。P9のImageGen出力を受け入れる前にP10へ進まず、
生成済みPNGや既存sourceを上書きしない。

### P0: 原画と契約の固定

| ID | 作業 | 完了条件 |
|---|---|---|
| AP-01 | Image Genでtitle logo原画を作る | 正確な文字、透過または均一キー背景、世代を模したpixel化なし |
| AP-02 | `Docs/character.png` を参照して上半身原画を作る | 同一キャラクターと判別でき、下端pivot、主要輪郭、背景分離が成立 |
| AP-03 | provenanceを記録する | プロンプト、参照、採用出力、禁止した世代別直接生成を追跡できる |

### P1: app scaffold

| ID | 作業 | 完了条件 |
|---|---|---|
| AP-04 | workspace package、Vite、TypeScript、Vitest、ESLintを追加する | 空のappがdev/build/testできる |
| AP-05 | canvas、responsive layout、URL初期世代を追加する | 4世代の初期化とresizeが例外なく動く |
| AP-06 | browser/tool用tsconfigを分離する | `src` からNode型とasset pipelineを参照できない |

### P2: asset生成

| ID | 作業 | 完了条件 |
|---|---|---|
| AP-07 | 2つのasset classとrecipeを定義する | dry-runで8出力の寸法・能力値が計画と一致する |
| AP-08 | matte、crop、resample、palette builderを実装する | 全8画像が共通validatorを通る |
| AP-09 | build/check scriptsとmanifestを追加する | build後のcheck成功、再buildのwritten件数0 |
| AP-10 | sample固有asset検査を追加する | FC色集合、RGB555、alpha、boundsを検査できる |

### P3: runtime

| ID | 作業 | 完了条件 |
|---|---|---|
| AP-11 | renderer manifestと世代別URL表を追加する | 8画像だけがruntime textureとして登録される |
| AP-12 | title `GameModule` とscreen-space配置を実装する | 4世代でロゴとキャラクターが所定位置に出る |
| AP-13 | step/Tweenとpivot補正を実装する | §3.3の動作とunit testを満たす |
| AP-14 | action mapと世代切替を実装する | direct/cycle操作とtransitionが動く |

### P4: 検証とworkspace統合

| ID | 作業 | 完了条件 |
|---|---|---|
| AP-15 | unit、render frame、lifecycle testを追加する | sample workspaceのtestが全件成功 |
| AP-16 | 4世代captureを取得し目視確認する | §8.4の観点を満たしcaptureを保存 |
| AP-17 | root lint/test/build/verifyへsampleを追加する | root `npm run verify` が成功 |
| AP-18 | READMEまたは本書へ実行手順と結果を追記する | 新規利用者が生成、起動、検査を再現できる |

### P5: animation asset生成（完了済み・P9/P10で置換）

| ID | 作業 | 完了条件 |
|---|---|---|
| AP-19 | 9つのcharacter frame IDと共通recipeを定義する | 旧設計として計40出力を作成済み。source経路は不適合 |
| AP-20 | body shear、ponytail warp、blink warpをbuilderへ実装する | 旧実装。P10で削除する |
| AP-21 | 共通FC paletteと40出力contractへ検査を更新する | 全frameと背景を含むFC色数が25以内になる |

### P6: title animation runtime

| ID | 作業 | 完了条件 |
|---|---|---|
| AP-22 | render manifestを40 textureへ拡張する | generation/pose/eyesから一意なURLを引ける |
| AP-23 | 世代profileに沿うsway、ponytail、blink stateを実装する | FC/SFCはrotation 0、PS1/PS2だけTweenになる |
| AP-24 | GameModuleのtexture選択とテストを更新する | transition中も両世代が正しいframeを描画する |

### P7: generation-aware BGM

| ID | 作業 | 完了条件 |
|---|---|---|
| AP-25 | 120 BPMのタイトルScoreと能力ベース編曲を実装する | 4世代で旋律・拍・loop長を共有する |
| AP-26 | generation audio service、unlock、fallbackを起動へ統合する | browser制限下でも起動し、操作後は音が鳴る |
| AP-27 | 世代切替時のprofile/arrangement追従をテストする | tickをresetせず音源と編曲が切り替わる |

### P8: 統合検証と完了記録

| ID | 作業 | 完了条件 |
|---|---|---|
| AP-28 | sample verifyとroot verifyを実行する | asset/check/lint/test/build/boundaryが成功する |
| AP-29 | 4世代captureとREADMEを更新する | 新frameの表示を目視確認し再現手順を残す |
| AP-30 | 本書の状態と検証結果を更新する | 全追加要件とcommitの対応を追跡できる |

### P9: ImageGen animation source set

| ID | 作業 | 完了条件 |
|---|---|---|
| AP-31 | `Docs/character.png` と `art/source/character-upper.png` を `view_image` で確認し、identity-preserve prompt、不変条件、pose定義を固定する | 参照画像の役割、変更可／不可、canvas、pivot、背景、命名がprovenance草稿にある |
| AP-32 | built-in ImageGenを1 variant 1 call以上で実行し、開眼3poseからhalf/closedを派生させる | 9つの異なるPNGが `art/source/character-{pose}-{eyes}.png` に保存され、既存fileを上書きしていない |
| AP-33 | 9枚を目視選定し、prompt、参照、採否、SHA-256、寸法、alphaを記録する | 同一人物・衣装・構図・pivotが維持され、指定した姿勢、髪、目以外のdriftがない |

P9 commit: `feat(asset-sample): add imagegen animation source frames`

### P10: pipeline source migration

| ID | 作業 | 完了条件 |
|---|---|---|
| AP-34 | 9つのcharacter asset IDを同名sourceへ1対1で割り当てる | manifestで9つのsource path / hashを追跡でき、`character-upper.png` は変換入力外になる |
| AP-35 | `motionWarp`、`blinkWarp`、body shearと同等処理を削除し、共通crop / tone / palette変換だけにする | animation差分がsourceに存在し、builderが世代変換だけを行う |
| AP-36 | 共通canvas / pivot、source差分、共有FC palette、40出力、決定性のcontractを更新する | `assets:build` / `assets:check` / `check:assets`が成功し、再buildのwritten件数が0 |

P10 commit: `refactor(asset-sample): derive animation assets from source frames`

### P11: authored pose対応runtime

| ID | 作業 | 完了条件 |
|---|---|---|
| AP-37 | poseごとの `authoredPoseAngle` とPS1/PS2のresidual Tweenを実装する | FC/SFCはrotation 0、PS1/PS2はsource姿勢と合成して±5°相当を超えない |
| AP-38 | animation / render / lifecycle testをsource frame semanticsへ更新する | pose切替、blink、reduced motion、transition、pivot、角度連続性を自動検査できる |

P11 commit: `fix(asset-sample): align tween with authored motion frames`

### P12: integration verification and documentation

| ID | 作業 | 完了条件 |
|---|---|---|
| AP-39 | 4世代captureを同じ位相で再取得し、原画9枚と各世代の揺れ・目パチを目視比較する | identity drift、frame jump、二重傾斜、halo、欠けがなく、全世代でsource差分を確認できる |
| AP-40 | README、provenance、本書の状態・結果・commit対応を更新する | ImageGen → `art/source` → pipeline → runtimeの再現手順が一致する |
| AP-41 | sample verifyとroot verifyを実行する | asset/check/lint/test/build/boundaryを含む全検査が成功する |

P12 commit: `docs(asset-sample): verify imagegen source-frame workflow`

修正の依存順は `計画更新 → P9 → P10 → P11 → P12` とする。各commitの直前にそのフェーズの検査を実行し、
次フェーズの変更を混在させない。ImageGenによるsource生成はP9だけ、世代変換はP10だけで行う。

## 10. package scripts

sample packageへ次を用意する。

```json
{
  "scripts": {
    "dev": "vite",
    "assets:build": "console-chaos-assets build --config tools/art.config.mjs",
    "assets:check": "console-chaos-assets check --config tools/art.config.mjs",
    "check:assets": "tsx tools/check-assets.ts",
    "lint": "eslint . && tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    "test": "vitest run",
    "build": "vite build",
    "verify": "npm run assets:check && npm run check:assets && npm run lint && npm run test && npm run build"
  }
}
```

root `verify` では、asset-pipeline packageをbuildしてCLIを利用可能にした後でsampleの `verify` を実行する。
既存の `tools/check-boundaries.ts` は `apps/**/src` からasset pipelineへのimportを検出するため、
sampleも同じ境界検査へ自動的に含まれる。

## 11. 実行・検証手順

実装後の標準手順を次で固定する。

```sh
npm run build:asset-pipeline
npm run assets:build -w @console-chaos/asset-pipeline-sample
npm run assets:check -w @console-chaos/asset-pipeline-sample
npm run verify -w @console-chaos/asset-pipeline-sample
npm run dev -w @console-chaos/asset-pipeline-sample
npm run verify
```

試行調整は製品出力と分離する。

```sh
console-chaos-assets build \
  --config apps/asset-pipeline-sample/tools/art.config.mjs \
  --only character-center-open \
  --generation FC \
  --out-dir apps/asset-pipeline-sample/build/art-trial \
  --set tone.FC.saturation=1.1
```

## 12. リスクと対策

| リスク | 対策 |
|---|---|
| Image Genのロゴ文字が誤字になる | 文字列を目視で1文字ずつ照合し、正確な出力だけを採用する |
| ImageGen call間で顔・衣装・構図がdriftする | 開眼3poseをanchorにhalf/closedを個別編集し、全promptでidentityと不変条件を反復する。指定外の差がある出力は採用しない |
| 9枚のcanvas / pivotがずれてframe切替で跳ねる | 同一canvasと下端pivotをpromptで固定し、pipeline前のsource bounds検査と同位相captureで確認する |
| ImageGen出力に真正のalphaがない | 透明背景を明示する。失敗時だけ被写体と重ならない均一key背景を採用し、provenanceへ記録して `keyOut()` する |
| ImageGen出力がworkspace外にだけ残る | 採用fileを必ず `art/source` へ保存し、provenanceのpathとSHA-256を検査する |
| 既存sourceや採用assetを上書きする | 新規の意味的file名を使い、不採用出力は別管理する。上書きは行わない |
| FCで顔の情報が消える | 16色を髪・肌・目・衣装の明度差へ優先配分し、試行はrecipe overrideで行う |
| FCの画面全体色数が25色を超える | ロゴ4色＋キャラクター16色を上限とし、背景は単色に限定する |
| frameごとの減色結果でFCの色集合が増える | canonical frameから共通paletteを作り9frameへ適用する |
| 目パチで顔全体が変化する | 各poseのopen画像を直接参照してhalf/closedを生成し、目周辺以外の差を目視比較する |
| 回転で腰が横滑りする | 下端中央pivotからsprite中心を逆算し、座標不変をunit testする |
| sourceの姿勢とPS1/PS2回転が二重になる | `authoredPoseAngle` を宣言し、runtimeは目標角との差分だけを回転する。端点角と切替連続性をtest / captureで確認する |
| transitionで片方の世代画像が消える | 4世代commandを常時frameへ積み、generation maskでrendererに選ばせる |
| PS1/PS2もコマ送りに見える | profileの30/60 Hzへ時刻を量子化した後にTweenし、captureで連続性を確認する |
| autoplay制限で無音になる | 最初のpointer/keyboard操作でunlockし、失敗時は画面を止めずnull audioへfallbackする |
| 世代切替でBGMが曲頭へ戻る | profileとarrangementを分離し、切替時は `useScore()` だけを呼ぶ |
| asset pipelineがbrowser bundleへ混入する | src/tool tsconfig分離、boundary検査、build output検査を行う |
| 生成済みPNGが手修正される | `assets:check` とdeterministic manifestをCI必須にする |

## 13. Definition of Done

次のすべてを満たした時点で完了とする。

- ImageGen由来のproduction入力10枚（ロゴ1＋character 9）と参照anchor、完全なprovenanceが存在する
- 9つのcharacter asset IDが同名の異なるImageGen sourceへ1対1で対応する
- 姿勢、ポニーテール、目パチを作るコードwarp / shearがbuilderに存在しない
- 10枚のproduction入力から `@console-chaos/asset-pipeline` だけで40個の世代別PNGを生成できる
- 生成済みPNGを直接編集していないことを `assets:check` で確認できる
- 4世代のロゴ、キャラクター、背景、animationが§4の完成条件を満たす
- 第1・第2世代はImageGen姿勢assetの離散パターン、第3・第4世代は同じkey pose＋residual Tweenとして目視で区別できる
- 4世代すべてでポニーテール揺れと目パチを確認できる
- 120 BPMの同一BGMが世代別の音源・同時発音数・編曲で再生され、切替時も拍位置を保つ
- direct/cycle入力、transition、reduced-motion、disposeが動作する
- asset、unit、lifecycle、build、boundaryの全検査が成功する
- 4世代captureと実行手順が保存される
- root `npm run verify` が成功する

## 14. 旧実装結果と修正判定（2026-08-16）

追加要件のP5〜P8は一度完了したが、P5/P6のanimation source経路は不適合と判定した。
次のcommitは履歴として保持し、P9〜P12で生成物と実装を置き換える。

| フェーズ | commit | 結果 |
|---|---|---|
| 計画更新 | `6a28d86` | PLAN差分を40出力・animation・audio設計へ反映 |
| P5 | `24a1c74` | 単一character原画をコード変形して36枚を生成。**source要件不適合、P9/P10で置換対象** |
| P6 | `3d4a854` | 旧warp frameとTweenを統合。**P11でImageGen key pose semanticsへ修正対象** |
| P7 | `944068f` | 120 BPM Score、能力ベース編曲、世代別音源、audio unlockを統合 |
| P8 | `docs(asset-sample): complete animated title integration` | capture、README、本書、全体検証を更新 |

旧実装の検証結果（修正後の受入結果としては扱わない）:

- `npm run verify -w @console-chaos/asset-pipeline-sample`: 成功
- asset contract: 40 outputs、FCのロゴ＋全character frameの共有色17色
- Vitest: 5 files / 18 tests 成功
- lint、browser/tool TypeScript、Vite production build: 成功
- `npm run verify`: 成功（Engine 46、asset pipeline 25、sample 18、Console Chaos 415、E2E 2 testsを含む）
- `Docs/captures/title-{fc|sfc|ps1|ps2}.png`: 1280×720、`captureTime=0.5` で再取得
- ブラウザ目視: 4世代のロゴ、姿勢、layout、世代別描画を確認。console warning/errorなし

修正計画の現在地:

| 項目 | 状態 |
|---|---|
| 計画更新 | 完了。本書にImageGen source set、pipeline移行、runtime補正、検証を定義 |
| P9 ImageGen source set | 未着手 |
| P10 pipeline source migration | 未着手 |
| P11 authored pose runtime | 未着手 |
| P12 integration verification | 未着手 |
