# Asset Pipeline Sample 実装計画

参照: [PLAN.md](PLAN.md)

作成日: 2026-08-16

状態: 追加要件を実装・検証済み（2026-08-16）

## 1. 目的

`@console-chaos/asset-pipeline` の最小かつ実用的なサンプルとして、1つの原画から
`FC / SFC / PS1 / PS2` の能力差に沿った画像を生成し、Console Chaos Engine 上のタイトル画面で表示する。

完成物は次を同時に示す。

- Image Gen で用意した世代非依存の原画を入力にする
- 世代別画像は手作業せず、必ず `@console-chaos/asset-pipeline` から生成する
- asset pipeline は Node.js の build-time tool に閉じ、ブラウザコードから import しない
- Engine の世代プロファイル、世代切替、世代別 renderer を利用する
- 第1・第2世代は原画から生成した離散姿勢画像、第3・第4世代は Tween でキャラクターを左右へ揺らす
- 同じ原画から生成したframeでポニーテール揺れと目パチを表現する
- 同一の楽曲データをEngineの世代別音源・同時発音数へ編曲し、体揺れと拍を同期する

## 2. スコープ

### 2.1 実装対象

- 1画面だけのタイトル画面
- `Console Chaos Engine` のタイトルロゴ
- [character.png](character.png) のキャラクターを元にした上半身画像
- ロゴと、姿勢3種×目3種のキャラクターframeそれぞれの4世代出力
- FC/SFCの画像パターン切替、PS1/PS2のTween
- ポニーテール揺れと目パチアニメーション
- 世代別の音声能力に沿ったタイトルBGM
- キーボード／ゲームパッドによる世代切替
- asset生成、決定性、runtime配置、アニメーションの自動検査
- 4世代の目視確認

### 2.2 スコープ外

- ゲーム本編、タイトル決定後の遷移、効果音
- 世代ごとに別の構図・表情・ポーズをAI生成すること
- glTF、動画、音声の変換
- asset pipeline 共通パッケージへのゲーム固有機能の追加
- DOM/CSSだけでロゴを代替すること
- runtimeで原画を動的変換すること

## 3. 先に固定する設計判断

### 3.1 原画は素材ごとに1枚だけ

原画は次の2枚だけを使用する。

| 素材ID | 原画 | 用途 |
|---|---|---|
| `title-logo` | `art/source/title-logo.png` | 正確に `Console Chaos Engine` と読める透過ロゴ |
| `character` | `art/source/character-upper.png` | `Docs/character.png` と同じキャラクターの上半身透過画像 |

どちらも Image Gen で作成する。`character-upper.png` は新しいキャラクターを生成するのではなく、
`Docs/character.png` を参照画像にした編集として、顔、髪、猫耳、衣装、配色を維持したまま上半身構図へ整える。

現行の `Docs/character.png` は 1080×1920、8-bit RGB、不透明で、白い中央部と左右のカーテンを含む。
背景が均一キー色ではないため、`keyOut()` の閾値調整だけで直接切り抜く入力にはしない。
Image Gen の編集結果を透過PNG、または被写体と重ならない均一な単色背景のPNGとして出力し、
後者の場合だけ `keyOut()` と `cropToOpaque()` を asset pipeline の builder 内で適用する。

Image Gen のプロンプト、参照画像、採用理由、出力ファイルを `Docs/ASSET_PROVENANCE.md` に記録する。
AI出力はあくまで世代非依存の原画であり、`fc` などの世代名を含む画像をImage Genから直接作らない。

### 3.2 世代別画像の唯一の生成経路

`tools/art.config.mjs` を変換定義の正本とし、次の経路だけを許可する。

```text
Image Gen原画
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

左右への揺れは世代の能力に応じて2つの経路へ分ける。いずれも `character-upper.png` だけを入力とし、
世代別frameをImage Genや画像編集ソフトで直接制作しない。

| 世代 | 動作 | サンプリング | 角度 |
|---|---|---:|---:|
| FC | pipelineで生成した `左 → 中央 → 右 → 中央` の画像パターン切替。runtime回転なし | profileの6 Hz | 見かけ±5°相当 |
| SFC | pipelineで生成した `左 → 中央 → 右 → 中央` の画像パターン切替。runtime回転なし | profileの12 Hz | 見かけ±5°相当 |
| PS1 | 左右の目標角間を ease-in-out Tween | profileの30 Hz | ±5° |
| PS2 | 左右の目標角間を ease-in-out Tween | profileの60 Hz | ±5° |

1往復は1秒とし、全世代で拍の位置は共有する。PS1/PS2だけ周期や振幅を変えるのではなく、
同じ位相に対する補間方法とサンプリング密度だけを変える。

FC/SFCの姿勢frameは下端を固定した水平方向のshearで生成し、角度を変えた1枚絵に見えない輪郭差を持たせる。
PS1/PS2の回転中心は画像中央ではなく上半身の下端中央とする。`SpriteCommand` 自体は中央回転なので、
下端中央をpivotとして回したときのsprite中心を毎frame計算し、腰が横滑りしないようにする。

### 3.4 ポニーテールと目パチもpipeline出力にする

キャラクターframe IDは `character-{left|center|right}-{open|half|closed}` の9種とする。

- `left / center / right` はポニーテール領域へ滑らかな局所warpを適用する
- FC/SFCでは同じframeへ体の離散姿勢も焼き込む
- PS1/PS2では体を直立のままにし、ポニーテール差分だけを焼き込む
- `open / half / closed` は両目領域の縦方向warpで生成し、手描きの世代別frameを追加しない
- blink周期は3秒とし、FCは開閉2frame、SFC以降は半閉じを含むframe列をprofileのanimation Hzでsampleする
- reduced motionでは体とポニーテールを中央に固定するが、目パチは停止しない

9種は同じsource hashと共通recipeを持つ。FCの全frameは共通の16色paletteを使い、frame切替で
画面全体の色数が増えないようにする。

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

- 原画2枚からロゴ4枚とキャラクター36枚、計40枚の世代別PNGが生成される
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
      character-upper.png
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

ロゴとキャラクターで同じ共通処理を使い、意味の違うcrop/matteとframe変形だけを素材IDで選ぶ。

1. 入力PNGをdecodeする
2. 必要な場合だけ `keyOut()` で均一背景を透明化する
3. `cropToOpaque()` とpaddingで正規化する
4. 出力と同じ縦横比へ中央cropする
5. `resample()` で世代別寸法へ縮小する
6. frame IDから局所的なポニーテールwarpと目の縦方向warpを適用する
7. FC/SFCだけ下端固定の離散姿勢shearを適用する
8. `applyTone()` でrecipeの階調と彩度を適用する
9. canonicalな中央・開眼frameから共通paletteを作り、同じ世代の全frameへ適用する
10. `applyPalette()` でpalette、ディザ、alpha thresholdを適用する
11. `BuiltAsset.paletteCount` と画像をrunnerへ返す
12. runnerの共通検査を通してPNGとmanifestを書き出す

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
  eyes: 'open' | 'half' | 'closed';
}
pivotedSpriteCenter(pivot, size, angle): readonly [number, number]
```

世代IDの `if` を散らさず、`defineGenerationVariant()` で次を網羅定義する。

- `mode: 'step' | 'tween'`
- `sampleHz`（profileの `video.animationHz` と一致）
- `amplitudeRadians`
- `cycleSeconds`
- step patternまたはeasing
- blink frame sequence

Tweenは左右の端で速度が0になる `smoothstep` または同等のease-in-outを使う。
PS1は1/30秒、PS2は1/60秒へ時刻を量子化してから補間する。
低世代は補間値を計算せず `rotation: 0` のまま、宣言した画像パターンを直接返す。
FC/SFCはasset内で体と逆方向へポニーテールをwarpし、PS1/PS2はtexture選択を体のTweenから
1 sample遅らせる。体と髪が一体の板として回転しているだけに見えない動きを作る。

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
- manifestのsource pathが `art/source` の2枚だけを指す
- 寸法、visible color count、palette mode、alpha modeが§6.1の契約と一致する
- FCの全可視RGBがEngineのmaster paletteに所属する
- SFCの全可視RGBがRGB555で表現できる
- FCのロゴと全キャラクターframeの色集合の和が20色以下である
- 透明画素のRGBがclear blackへ正規化されている
- 全character frameのopaque boundsが空でなく、意図しない四辺の切れがない
- FC/SFCのleft/center/rightがdecode後RGBAで異なる
- open/half/closedがdecode後RGBAで異なる
- 2回のbuildで2回目に書き込みが発生せず、Git差分も増えない

### 8.2 unit test

`tests/animation.test.ts`:

- FC/SFCのruntime角度が常に0°である
- FC/SFCのposeが `left / center / right` の宣言パターンだけを取り、sample区間内で変化しない
- PS1/PS2は端点で正確に±5°となり、中間で単調に補間する
- 同じ時刻のPS1/PS2が同じ方向を向く
- blinkが3秒周期で `open / half / closed` の世代別frame列を取る
- ポニーテールposeが体に対して1 sample遅れる
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
| motion | 明確なコマ切替 | 明確なコマ切替 | 30 Hz Tween | 60 Hz Tween |
| layout | 下端pivot固定 | 同左 | 同左 | 同左 |

白背景と暗背景の両方で一時確認し、haloが暗背景でだけ見つかる問題を防ぐ。

## 9. 実装フェーズ

P0〜P4は初回実装で完了済み。PLAN.mdの2026-08-16追加要件をP5〜P8として実装し、
各フェーズを独立したcommitにする。

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

### P5: animation asset生成

| ID | 作業 | 完了条件 |
|---|---|---|
| AP-19 | 9つのcharacter frame IDと共通recipeを定義する | 原画追加なしで計40出力のplanが確定する |
| AP-20 | body shear、ponytail warp、blink warpをbuilderへ実装する | left/center/rightとopen/half/closedのRGBA差を検査できる |
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

追加実装の依存順は `計画更新 → P5 → P6 → P7 → P8` とする。生成済みPNGを手修正せず、
P5のasset contractが確定してからruntimeのtexture参照を切り替える。

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
| 現行character画像の背景が切り抜けない | 参照編集で均一背景または透過の上半身原画を1枚作り、世代別編集は行わない |
| FCで顔の情報が消える | 16色を髪・肌・目・衣装の明度差へ優先配分し、試行はrecipe overrideで行う |
| FCの画面全体色数が25色を超える | ロゴ4色＋キャラクター16色を上限とし、背景は単色に限定する |
| frameごとの減色結果でFCの色集合が増える | canonical frameから共通paletteを作り9frameへ適用する |
| 局所warpで髪や目の輪郭に穴が開く | inverse mappingで必ず出力画素から入力をsampleし、boundsと差分を自動検査する |
| 目パチが顔全体の変形に見える | 2つの楕円領域だけを縦方向へwarpし、open/half/closedを目視比較する |
| 回転で腰が横滑りする | 下端中央pivotからsprite中心を逆算し、座標不変をunit testする |
| transitionで片方の世代画像が消える | 4世代commandを常時frameへ積み、generation maskでrendererに選ばせる |
| PS1/PS2もコマ送りに見える | profileの30/60 Hzへ時刻を量子化した後にTweenし、captureで連続性を確認する |
| autoplay制限で無音になる | 最初のpointer/keyboard操作でunlockし、失敗時は画面を止めずnull audioへfallbackする |
| 世代切替でBGMが曲頭へ戻る | profileとarrangementを分離し、切替時は `useScore()` だけを呼ぶ |
| asset pipelineがbrowser bundleへ混入する | src/tool tsconfig分離、boundary検査、build output検査を行う |
| 生成済みPNGが手修正される | `assets:check` とdeterministic manifestをCI必須にする |

## 13. Definition of Done

次のすべてを満たした時点で完了とする。

- Image Gen由来の2つの原画とprovenanceが存在する
- 原画から `@console-chaos/asset-pipeline` だけで40個の世代別PNGを生成できる
- 生成済みPNGを直接編集していないことを `assets:check` で確認できる
- 4世代のロゴ、キャラクター、背景、animationが§4の完成条件を満たす
- 第1・第2世代は姿勢assetの離散パターン、第3・第4世代はruntime Tweenとして目視で区別できる
- 4世代すべてでポニーテール揺れと目パチを確認できる
- 120 BPMの同一BGMが世代別の音源・同時発音数・編曲で再生され、切替時も拍位置を保つ
- direct/cycle入力、transition、reduced-motion、disposeが動作する
- asset、unit、lifecycle、build、boundaryの全検査が成功する
- 4世代captureと実行手順が保存される
- root `npm run verify` が成功する

## 14. 実装結果（2026-08-16）

追加要件のP5〜P8を完了した。

| フェーズ | commit | 結果 |
|---|---|---|
| 計画更新 | `6a28d86` | PLAN差分を40出力・animation・audio設計へ反映 |
| P5 | `24a1c74` | 2原画からロゴ4枚＋character 36枚を決定的生成 |
| P6 | `3d4a854` | FC/SFC asset pose、PS1/PS2 Tween、ponytail、blinkをruntimeへ統合 |
| P7 | `944068f` | 120 BPM Score、能力ベース編曲、世代別音源、audio unlockを統合 |
| P8 | `docs(asset-sample): complete animated title integration` | capture、README、本書、全体検証を更新 |

検証結果:

- `npm run verify -w @console-chaos/asset-pipeline-sample`: 成功
- asset contract: 40 outputs、FCのロゴ＋全character frameの共有色17色
- Vitest: 5 files / 18 tests 成功
- lint、browser/tool TypeScript、Vite production build: 成功
- `npm run verify`: 成功（Engine 46、asset pipeline 25、sample 18、Console Chaos 415、E2E 2 testsを含む）
- `Docs/captures/title-{fc|sfc|ps1|ps2}.png`: 1280×720、`captureTime=0.5` で再取得
- ブラウザ目視: 4世代のロゴ、姿勢、layout、世代別描画を確認。console warning/errorなし
