# Console Chaos Racing リニューアル実装計画書

> 本書は [RENEWAL_RECING_GAME.md](RENEWAL_RECING_GAME.md) を、現行の `apps/racing` と
> `@console-chaos/engine` の実装状況に合わせて実装可能な粒度へ具体化した計画書である。
>
> 初版: 2026-08-11  
> 対象: `apps/racing`、`packages/engine`、`packages/engine-testkit`  
> 本書の範囲: 実装順序、責務境界、成果物、受け入れ条件の定義。ゲーム本体の実装は含まない。

---

## 1. 目的

現行レーシングゲームの走行、ラップ、AI、世代切替の基礎を維持しながら、4つのコンソール世代が
単なる色・解像度違いではなく、それぞれ異なる時代の描画技術と音響仕様を持つレースゲームとして
明確に見分けられる状態へリニューアルする。

同時に、次の3機能をレースゲーム専用処理ではなく Console Chaos Engine の再利用可能な機能として追加する。

1. ラスタースクロール
2. 背景・地面のアフィン変換
3. 環境マップ

ゲーム固有のコース形状、車種、楽曲、演出、世代別アートは `apps/racing` が所有する。エンジンは
それらを描画・再生するための汎用コマンド、リソース管理、バックエンドだけを所有する。

---

## 2. 仕様の解釈と着手前の確認事項

### 2.1 世代と表現方式

本計画では原仕様を次のように解釈する。

| 世代            | 主要な表現                                   | 車両・コースのアセット                   | エンジン機能                                            |
| --------------- | -------------------------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| 第1世代 / `FC`  | 車体背後視点のラスタースクロールによる疑似3D | Image Gen で生成した2Dスプライトと背景   | raster scroll、palette、sprite limit、nearest sampling  |
| 第2世代 / `SFC` | 地面テクスチャのアフィン変換による疑似3D     | Image Gen で生成した2Dスプライトとタイル | affine plane、RGB555、nearest sampling                  |
| 第3世代 / `PS1` | 低ポリゴン3Dレース                           | glTF/GLBの低ポリゴン車両・コース         | 3D mesh、vertex quantize、affine texture、triangle sort |
| 第4世代 / `PS2` | ライティングと反射を持つ3Dレース             | glTF/GLBの高詳細車両・コース             | depth、dynamic light、environment map、linear sampling  |

原仕様のモデル節には「第1、第2世代は Image Gen」と「第1、第2世代は3Dメッシュ」が併記されている。
後者はグラフィックス節との整合性から「第3、第4世代は3Dメッシュ」の誤記と仮定する。アセット制作を
開始する前にこの仮定を確定し、原仕様も同時に訂正する。仮定が誤りの場合は Phase 4 のアセット方式を
変更するが、エンジンの描画機能と走行ロジックの計画は変更しない。

### 2.2 全世代で共通にするもの

- コースの論理中心線、幅、チェックポイント、スタート位置
- 60 Hz固定の走行シミュレーション、衝突、路外減速、復帰
- 3周、1人対1AI、カウントダウン、順位、リザルト、リスタート
- 入力アクションの意味とリプレイの決定性
- 1曲の構成、テンポ、小節位置

世代を切り替えても論理座標とレース進行は変えず、表示・操作デバイス特性・音源だけを切り替える。
これにより、切替によるショートカット、ラップ消失、AI位置ずれを発生させない。

### 2.3 今回の非目標

- 複数コース、車両選択、チューニング、ガレージ
- ネットワーク対戦、ゴースト配信、ランキング
- タイヤ、サスペンション、重量移動を含む車体シミュレーション
- コースエディタ、汎用マテリアルエディタ
- モバイル専用操作UI、ネイティブアプリ化
- Console Chaos 本編の見た目やゲーム内容の変更

---

## 3. 現状とリニューアル差分

### 3.1 維持できる現行実装

現行 `apps/racing` には次が成立しており、リニューアル時の回帰基準とする。

- `car.ts`: 60 Hzの決定的な加速、ブレーキ、ステア、後退、路外減速、境界拘束、復帰
- `track.ts`: 閉じたコース中心線と最近点・接線・進捗の取得
- `lap.ts`: 順序付きチェックポイント、正方向通過、ラップタイム
- `ai.ts`: 決定的な経路追従AI
- `race.ts`: 3秒カウントダウン、3周、順位、リザルト、リスタート
- `actions.ts`: keyboard/gamepadと世代別入力制約を通るAction Map
- `GameModule`: engine公開APIだけを用いた起動、更新、描画、破棄

2026-08-11時点の基準は Racing unit 9件、E2E 1件が合格である。この10件は置換せず、追加テストと
併せて全フェーズで実行する。

### 3.2 現状の不足

| 領域         | 現状                                             | 必要な差分                                                             |
| ------------ | ------------------------------------------------ | ---------------------------------------------------------------------- |
| 世代別映像   | 全世代が同じ平面ポリラインと矩形スプライト       | 世代ごとに独立した2D/疑似3D/3Dプレゼンテーションへ分割                 |
| レンダラ     | `CanvasRenderingContext2D` で色付きprimitiveのみ | texture、scanline変形、affine plane、glTF mesh、light、environment map |
| アセット参照 | Racingは画像・モデルを読み込まない               | manifest、preload、handle、generation variant、fallback                |
| 第1世代      | 通常のトップダウン描画                           | 背後視点、走査線単位の道路変形、スプライト制約                         |
| 第2世代      | 通常のトップダウン描画                           | アフィン変換された地面、地平線、スプライト車両                         |
| 第3世代      | primitiveを透視投影風に描画                      | 低ポリゴンmesh、PS1風頂点量子化・affine UV・depth非依存sort            |
| 第4世代      | 色・解像度・filter差のみ                         | depth、動的ライト、環境反射を持つmesh描画                              |
| BGM          | `playTone()`によるイベント音のみ                 | 同一曲の4音源アレンジ、世代切替時の位相維持                            |
| 車両音       | なし                                             | 速度/RPM連動の連続エンジン音、ブレーキ音                               |
| 検証         | command数とゲームロジック中心                    | 世代別画像golden、音声golden、実ブラウザ、性能、resource lifecycle     |

---

## 4. 完了条件

以下をすべて満たした時点でリニューアル完了とする。

### 4.1 プレイ成立

- 4世代すべてで、カウントダウンから3周完走、順位表示、リザルト、リスタートまで操作できる。
- 世代切替の前後で、車両位置、速度、向き、周回、チェックポイント、AI状態、経過時間が保存される。
- keyboardとgamepadでステア、アクセル、ブレーキ、リセット、世代切替が動作する。
- 既存の決定的リプレイに対する論理結果が変わらない。

### 4.2 世代表現

- 第1世代は背後視点とラスタースクロールで奥行きを表現し、通常のトップダウン表示に見えない。
- 第2世代はアフィン変換された地面でコースが地平線へ収束し、第1世代のscanline表現と区別できる。
- 第3世代は低ポリゴン3Dモデルを描画し、頂点量子化、nearest texture、affine textureの特徴が確認できる。
- 第4世代は3Dモデル、depth、動的ライト、環境マップ反射が同時に確認できる。
- 世代固有効果の有効化は `GenerationId` の直接比較ではなく、engineのhardware capabilityと
  appの`GenerationVariant`から決定する。

### 4.3 サウンド

- 1つの曲が、同じテンポ・小節構造を保った4つの世代別音源で再生される。
- 曲の再生中に世代を切り替えても、切替前後の小節位置のずれが許容誤差1 audio quantum以内である。
- エンジン音のpitch/gainが速度または正規化RPMに追従し、停止時と最高速時を聴き分けられる。
- 一定速度以上でブレーキを入力したときだけブレーキ音が鳴り、連続入力でvoiceが無制限に増えない。
- 世代別の発音数、音源方式、sample rate、reverb、定位制約をhardware profileから適用する。

### 4.4 エンジン境界

- raster scroll、affine plane、environment mapの型・描画処理・単体テストが `packages/engine` にある。
- engine内に `car`、`race`、`track`、`lap`、`checkpoint`などRacing固有の語彙を持ち込まない。
- `apps/racing` は `@console-chaos/engine` の公開入口だけをimportし、deep importを行わない。
- 既存 `createCanvasCommandRenderer()` と Console Chaos の検証結果を壊さない。
- assetとaudio resourceが、再起動・世代切替・`dispose()`後に残存しない。

### 4.5 品質ゲート

- rootの`npm run verify`が合格する。
- Racingのunit、engine contract、E2E、browser visual testが合格する。
- 4世代それぞれの基準スクリーンショットと音声測定結果を保存する。
- 対象ブラウザでconsole error、未処理Promise rejection、WebGL errorが0件である。
- 同一セッションで10回のリスタートと2往復の全世代切替を行っても、GPU/Audio resource数が単調増加しない。

---

## 5. アーキテクチャ方針

### 5.1 論理状態とプレゼンテーションの分離

`RaceState`を全世代共通の正本にし、描画側は読み取り専用の`RaceVisualState`へ投影する。

```text
ActionMap
   │
   ▼
RaceState ── fixed 60 Hz ──> car / AI / lap / rank
   │
   ├──> Gen1 frame builder ──> raster + sprite commands
   ├──> Gen2 frame builder ──> affine plane + sprite commands
   ├──> Gen3 frame builder ──> low-poly model commands
   └──> Gen4 frame builder ──> lit model + environment commands
```

世代別builderは物理状態を変更しない。カメラ、見た目上の横ずれ、道路の曲がり、アニメーションframeは
`RaceVisualState`から計算する。これにより、表示方式を変えてもゲーム結果を共通にできる。

### 5.2 レンダラ構成

現行Canvas rendererは互換・軽量テスト用として残す。新機能は、複数の内部render targetを持ち、最後に
表示canvasへ合成する汎用`createGenerationCommandRenderer()`へ追加する。

- 2D pass: textured sprite、背景、HUD
- raster pass: scanlineごとのsource offset/scaleを適用
- affine pass: 2D affine UV matrixを用いた地面描画
- 3D pass: glTF mesh、camera、depth/sort、light、environment map
- post pass: palette、RGB555、vertex quantize相当、signal/CRT、世代切替transition
- overlay pass: text/rectを既存commandと同じ座標系で合成

backendの選択はgeneration名ではなく、frameに積まれたcommandとhardware capabilityで決める。
未対応環境では環境マップを無効化したunlit/diffuse materialへ段階的にfallbackし、ゲーム進行は継続する。

### 5.3 engine公開API案

以下は Phase 1 でcontract testを先に作って確定する。名称は実装時に既存命名へ揃えてよいが、責務は維持する。

```ts
interface RasterScrollCommand {
  id: string;
  texture: TextureHandle;
  screenRect: readonly [number, number, number, number];
  scanlines: Float32Array; // 各行の sourceX / sourceWidth / shade 等
  layer?: number;
}

interface AffinePlaneCommand {
  id: string;
  texture: TextureHandle;
  screenRect: readonly [number, number, number, number];
  uvOrigin: Vec2;
  uvStepX: Vec2;
  uvStepY: Vec2;
  wrap: "repeat" | "clamp";
  layer?: number;
}

interface ModelCommand {
  id: string;
  model: ModelHandle;
  transform: TransformCommand;
  material?: MaterialOverride;
  animation?: AnimationSample;
  layer?: number;
}

interface EnvironmentCommand {
  texture: CubeTextureHandle | EquirectTextureHandle;
  intensity: number;
  rotationY?: number;
}

interface MaterialOverride {
  baseColor?: Color;
  baseColorTexture?: TextureHandle;
  environmentStrength?: number;
  roughness?: number;
  unlit?: boolean;
}
```

`RasterScrollCommand`には道路という概念を含めず、アプリが作った走査線変形表だけを描く。
`AffinePlaneCommand`にもコースや地面という概念を含めず、UVの開始点と増分だけを描く。
環境マップはmesh materialの任意入力とし、Racing以外でも利用できる形にする。

### 5.4 hardware capabilityの拡張

`HardwareGenerationProfile.video`へ、少なくとも次の能力を追加する。

- `rasterScroll: boolean`
- `environmentMap: boolean`
- 必要なら`maxDynamicLights`と`reflectionPrecision`

値は第1世代のみraster、第4世代のみenvironment mapを有効にする。既存の`affinePlane`、
`affineTexture`、`depthBuffer`、`dynamicLight`と組み合わせ、アプリ側の世代ID分岐を避ける。
profile追加時はConsole Chaosのprofile parity testも更新し、値の追加以外に既存値が変わっていないことを検査する。

### 5.5 asset lifecycle

- Racingのmanifestがlogical keyから世代別URL、種類、fallbackを定義する。
- engine `AssetManager`がImageBitmap、texture、cube/equirect map、glTF/GLBの重複loadと参照数を管理する。
- `GameModule.create()`で必須assetをpreloadし、完了前は走行を開始しない。
- 世代切替中は旧世代と新世代のassetを同時保持し、transition完了後に不要分をreleaseする。
- context loss時はCPU側sourceからGPU resourceを再生成する。
- `dispose()`では全handle、AudioNode、buffer、texture、program、framebufferを解放する。

---

## 6. 世代別実装

### 6.1 第1世代: ラスタースクロール

#### Racing側

- 車体後方に固定した疑似カメラ用に、コース中心線を車両前方距離へsampleする。
- 各scanlineに対し、道路中心X、道路幅、カーブ量、明度、縁石phaseを決定する。
- 遠方ほど狭く、手前ほど広い道路帯を生成し、ステアとコース曲率で中心を左右へずらす。
- player車は画面下部の大きなスプライト、AI車は距離に応じたframe/scaleで表示する。
- 背景、路肩、道路、縁石、車両の画像はImage Genによる共通art directionから生成する。
- paletteとsprites-per-scanline制約を通し、表示超過時の優先順位を定義する。

#### Engine側

- scanline transform tableの検証、buffer再利用、clippingを実装する。
- Canvas 2D fallbackは1行単位の`drawImage`、WebGL backendはlookup textureまたはvertex stripで描画する。
- `fixed54` palette、nearest sampling、RF/scanline post effectを既存profileから適用する。
- 入力tableが解像度と一致しない場合は例外ではなく明示的validation errorを返す。

#### 受け入れ条件

- 直線、左右カーブ、路外の3ケースでscanline中心と幅がgolden値に一致する。
- player停止中も道路が発散せず、加速時に前進が視認できる。
- 256×224の画像goldenで、地平線、道路端、player、AI、HUDが所定位置にある。
- scanline配列とGPU bufferを毎frame新規確保しない。

### 6.2 第2世代: アフィン変換背景

#### Racing側

- 共通コース中心線から、world-to-texture座標とカメラ位置・向きを算出する。
- 地平線より下をaffine plane、上を背景、車両とコース脇objectをspriteとして構築する。
- 車両spriteは前後左右の向きと距離の段階を持ち、profileの`animationHz`でframe更新する。
- 路面、芝、縁石、背景、車両画像をImage Genで生成し、seamless tileへ後処理する。

#### Engine側

- affine UV originとX/Y増分をshaderへ渡し、repeat/clamp、nearest samplingを実装する。
- RGB555変換、内部256×224、composite signalのpost effectを既存処理と統合する。
- CPU参照実装をtest用に持ち、shader出力のsample点と比較できるようにする。

#### 受け入れ条件

- 既知のUV matrixに対する四隅と中央のsample位置がCPU/GPUで一致する。
- 直線・カーブで路面が地平線へ収束し、車両の旋回に合わせて地面が回転する。
- tile境界に1pxの継ぎ目がなく、縁石の周期が世代切替前後の論理進捗と一致する。
- 第1世代のraster passを使用せずに成立する。

### 6.3 第3世代: 低ポリゴン3D

#### Racing側

- course centerlineから道路、路肩、壁、start gateの低ポリゴンmeshを生成または読み込む。
- player/AIは低ポリゴン車両GLBを使用し、wheel回転など最小限のanimationを持たせる。
- materialは小さなtexture atlas、nearest sampling、unlitまたは固定light中心とする。
- cameraは背後追従とし、表示上の揺れは論理headingを変更しないpresentation effectにする。

#### Engine側

- glTF subset loaderの出力をGPU meshへuploadし、model instance commandから描画する。
- `vertexQuantize`、`affineTexture`、triangle sortをhardware profileから適用する。
- depth bufferが無効な場合のtransparent/opaque順序を決定的にする。
- index/accessor/materialの未対応形式はpreflightで検出し、実行時に黙って欠落させない。

#### 受け入れ条件

- 車両、コース、背景objectが実meshとして表示され、2D矩形へのfallbackが通常経路で使われない。
- camera移動時にvertex quantizationとaffine UVの特徴が視認できる。
- 同じ入力replayで3回captureしたcommand順と最終frame hashが一致する。
- glTF preflight、triangle budget、texture size検査が合格する。

### 6.4 第4世代: ライティングと環境マップ

#### Racing側

- 第3世代より詳細な車両・コースGLB、法線、UV、必要に応じてtangentを用意する。
- 空・コース周囲を表すcube mapまたはequirectangular environment textureを用意する。
- 車体materialだけに適切なreflection strength/roughnessを設定し、路面やHUDへ一律適用しない。
- directional lightを主光源とし、必要最小限の補助lightを配置する。

#### Engine側

- depth test/write、normal変換、diffuse/specular、動的light上限を実装する。
- reflection vectorからcube/equirectangular mapをsampleし、base colorと合成する。
- environment mapなし、法線なし、低精度GPUのfallback materialを定義する。
- shader/program/textureのcache keyへmaterial capabilityを含める。

#### 受け入れ条件

- 車体の向きとcamera位置を変えると反射像が連続して変化する。
- lightを移動すると拡散光が変化し、環境反射だけの平坦な表示にならない。
- 第3世代へ切り替えたときenvironment mapとdynamic lightが確実に無効になる。
- 640×448内部解像度でtarget frame budgetを継続して満たす。

---

## 7. サウンド実装

### 7.1 BGM

Racing側に1つのmaster scoreを置き、engineの`Score`、`MusicClock`、世代別voice sourceを使って
4アレンジを生成する。曲の旋律、コード進行、小節数、tempoは共通とする。

| 世代    | アレンジ方針                            |
| ------- | --------------------------------------- |
| 第1世代 | PSG中心、少発音、短いnoise percussion   |
| 第2世代 | BRR sample、8 voice内、軽いreverb       |
| 第3世代 | ADPCM sample、左右定位、厚いdrum/bass   |
| 第4世代 | streaming品質、48 kHz、広い定位とreverb |

`RacingAudioDirector`はアプリに置き、曲そのものとアレンジ判断を所有する。engineへ置くのは
transport、voice source、voice limit、sample scheduling、phase-preserving source交換だけとする。

### 7.2 エンジン音

現行`AudioService.playTone()`は単発音向けであり、連続する車両音には使用しない。engineにゲーム非依存の
parameterized/looping voiceを追加し、Racing側が次を毎fixed tickまたは制御rateで更新する。

- `rpm01`: `abs(speed) / maxSpeed`を基礎に加速状態を加味
- `pitch`: 世代別patchの基音から補間
- `gain`: 停止、走行、最高速のcurve
- `pan`: positional対応世代のみcamera相対位置から設定

世代切替時は旧voiceを短くfade outし、同じ`rpm01`で新voiceをfade inする。AI車両音はplayerより低いgainとし、
hardware voice limitを超える場合は距離と重要度で抑制する。

### 7.3 ブレーキ音とレースcue

- `brake > threshold`かつ`abs(speed) > threshold`でskid/brake loopを開始する。
- 条件を外れたらreleaseし、短時間のon/offにはhysteresisとcooldownを適用する。
- countdown、start、lap、finishは既存イベントを維持し、世代別patchで再生する。
- 同じtickに複数cueが来た場合のpriorityを`finish > lap > start > countdown`とする。

### 7.4 音声の受け入れ条件

- `OfflineAudioContext`で4世代それぞれ2小節をrenderし、無音、clip、voice limit超過がない。
- 同一audio timeでの世代切替前後の`MusicClock.tickAt()`が許容誤差内で一致する。
- 0%、50%、100% RPMの基本周波数とgainがunit testの範囲内にある。
- brake条件とhysteresisを決定的な制御列で検査する。
- `dispose()`後にactive sourceとscheduled callbackが0になる。

---

## 8. アセット制作計画

### 8.1 Image Genを用いる第1・第2世代

アセット生成フェーズではImage Genスキルを用い、最初にart bible用の1枚を承認してから量産する。
世代ごとに個別promptを作るが、同一車種、同一コース、同一色識別を維持する。

必要な成果物:

- player車: 後方、後方左、後方右。必要なら距離・損傷差分
- AI車: 同じ角度セット、playerと判別できる配色
- 第1世代: 遠景、路肩、道路、縁石、trackside object
- 第2世代: seamless road/grass/curb tile、遠景、trackside sprite
- UI: 世代別メーター、順位・ラップ枠。文字自体は可読性のためengine overlayを優先

後処理で透明背景、pixel grid整列、palette制限、tile seam、sprite sheet metadataを検査する。
生成画像をそのまま実行時に加工せず、確定したPNG/WebPとmetadataをリポジトリへ保存する。

### 8.2 第3・第4世代の3Dアセット

- glTF 2.0 / GLBを正本とし、engine loaderが対応するsubsetだけを使う。
- 第3世代は低ポリゴン、少material、小texture atlas、nearest samplingを優先する。
- 第4世代は法線、複数material、環境反射用parameterを許可する。
- コースの論理collisionは既存centerlineから計算し、render meshをcollisionの正本にしない。
- model origin、forward axis、単位、wheel位置、texture color spaceをexport規約に記録する。

poly/texture上限は最初の代表assetを実機測定してから固定する。固定前の暫定目標は、第3世代の1台を
数千triangle・256px級atlas、第4世代の1台を数万triangle未満・1024px級atlasとし、画質より
安定したframe budgetを優先する。

### 8.3 manifest案

```text
apps/racing/public/assets/
  manifest.json
  shared/
    audio/
  gen1/
    sprites/
    backgrounds/
  gen2/
    sprites/
    tiles/
    backgrounds/
  gen3/
    models/
    textures/
  gen4/
    models/
    textures/
    environment/
```

manifest検査では、URL存在、hash、画像寸法、power-of-two要否、alpha、model preflight、generationごとの
必須key、未参照assetを検出する。

---

## 9. 目標ファイル構成

```text
packages/engine/src/
  generation/profiles.ts          # raster/environment capability
  render/frame.ts                 # 新しい汎用command
  render/renderer.ts              # 既存Canvas互換backend
  render/generation-renderer.ts   # composite renderer
  render/raster/                   # scanline validation/backend
  render/affine/                   # UV matrix、CPU reference、shader
  render/model/                    # glTF GPU resource、instance描画
  render/environment/              # cube/equirect map、reflection
  render/postfx/                   # palette/signal/profile適用
  assets/                          # image/model/environment handle
  audio/continuous-voice.ts       # 汎用parameterized voice
  audio/                           # 既存clock/source/service拡張

apps/racing/src/
  app.ts                           # lifecycleとsubsystem構成
  config/
    actions.ts
    themes.ts
    assets.ts
  content/
    track.ts
    assets.ts
    audio/
      score.ts
      arrangements.ts
      patches.ts
  gameplay/                        # 現行ロジックを維持
  presentation/
    visual-state.ts
    frame.ts                       # capabilityによるdispatcher
    gen1-raster.ts
    gen2-affine.ts
    gen3-low-poly.ts
    gen4-environment.ts
  audio/
    director.ts
    vehicle-sound.ts
  ui/
    hud.ts
    loading.ts
```

ファイル分割は責務を示すものであり、短い段階で無理に細分化しない。`frame.ts`へ4世代の実装を再集中させない
ことと、engineからRacing固有moduleをimportしないことを必須とする。

---

## 10. 実装フェーズ

各フェーズは独立したreview単位とし、末尾の受け入れ条件を満たすまで次の依存フェーズへ進まない。

### Phase 0 — 仕様固定とbaseline

| ID    | 作業                                                 | 成果物 / 受け入れ条件                 |
| ----- | ---------------------------------------------------- | ------------------------------------- |
| R0-01 | 「第1・第2世代は3Dメッシュ」の誤記仮定を確定         | 原仕様と本書の表が一致                |
| R0-02 | 現行10テストとroot verifyをbaselineとして記録        | commit、結果、ブラウザ、GPU情報を記録 |
| R0-03 | 同一入力replayで4世代の現行画像をcapture             | リニューアル前比較画像                |
| R0-04 | art direction、camera、HUD wireframeを世代ごとに固定 | 4枚の承認用style frame                |
| R0-05 | target browser、性能計測機、fallback方針を固定       | QA matrix                             |

### Phase 1 — Engine render contractとasset contract

依存: Phase 0

| ID    | 作業                                                  | 主な変更先                      | 受け入れ条件                                      |
| ----- | ----------------------------------------------------- | ------------------------------- | ------------------------------------------------- |
| E1-01 | raster/affine/model/environment command型を追加       | `engine/render/frame.ts`        | create/reset/recording renderer contract test合格 |
| E1-02 | profileへcapabilityを追加                             | `engine/generation/profiles.ts` | 全profileとConsole parity test合格                |
| E1-03 | image/model/environment handleとmanifest loaderを追加 | `engine/assets`                 | dedupe/ref-count/failure/dispose test合格         |
| E1-04 | composite rendererのpass順とfallbackを定義            | `engine/render`                 | 空frameと既存commandが現行同等に描画              |
| E1-05 | 公開exportとboundary ruleを更新                       | `engine/index.ts`、tools        | app deep import 0件                               |

### Phase 2 — ラスタースクロールとアフィン変換

依存: Phase 1

| ID    | 作業                                   | 主な変更先             | 受け入れ条件                           |
| ----- | -------------------------------------- | ---------------------- | -------------------------------------- |
| E2-01 | scanline table validationとbuffer pool | `engine/render/raster` | 範囲外、解像度差、reuseのunit test合格 |
| E2-02 | Canvas参照実装とWebGL raster pass      | `engine/render/raster` | sample画像の差分が閾値内               |
| E2-03 | affine CPU referenceとshader pass      | `engine/render/affine` | 既知UV座標とGPU captureが一致          |
| E2-04 | palette/filter/signal post effect統合  | `engine/render/postfx` | FC/SFC画像golden合格                   |
| E2-05 | context lossとresize対応               | renderer/platform      | 復帰後に同一frameを再描画              |

### Phase 3 — 3Dモデル、ライティング、環境マップ

依存: Phase 1。Phase 2と一部並行可能。

| ID    | 作業                                 | 主な変更先            | 受け入れ条件                        |
| ----- | ------------------------------------ | --------------------- | ----------------------------------- |
| E3-01 | glTF GPU uploadとmodel instance      | `engine/render/model` | box/model golden、resource解放合格  |
| E3-02 | PS1 profileのquantize/affine UV/sort | model shader/sort     | profile切替で効果がon/off           |
| E3-03 | depth、normal、dynamic light         | model shader          | normal/lightの数値・画像test合格    |
| E3-04 | cube/equirect environment loader     | assets/environment    | face向き、色空間、fallback test合格 |
| E3-05 | reflection materialとshader cache    | render/environment    | camera/normal別の反射方向が正しい   |
| E3-06 | WebGL capability fallback            | renderer              | 非対応機能を落として起動継続        |

### Phase 4 — Racingアセットと世代別presentation

依存: Phase 2、Phase 3のcommand contract。Image Gen制作と3D制作はcontract固定後に並行可能。

| ID    | 作業                                  | 主な変更先                  | 受け入れ条件                      |
| ----- | ------------------------------------- | --------------------------- | --------------------------------- |
| R4-01 | `RaceVisualState`とdispatcherを作る   | `presentation`              | builderが`RaceState`を変更しない  |
| R4-02 | 第1世代画像をImage Genで制作・後処理  | `assets/gen1`               | palette/alpha/寸法検査合格        |
| R4-03 | 第1世代raster builderを実装           | `gen1-raster.ts`            | 直線・左右curve golden合格        |
| R4-04 | 第2世代画像をImage Genで制作・tile化  | `assets/gen2`               | seam/palette/寸法検査合格         |
| R4-05 | 第2世代affine builderを実装           | `gen2-affine.ts`            | horizon/rotation golden合格       |
| R4-06 | 第3世代低poly assetsとbuilder         | `assets/gen3`、presentation | preflight、budget、画像golden合格 |
| R4-07 | 第4世代assets、environment、builder   | `assets/gen4`、presentation | light/reflection画像golden合格    |
| R4-08 | manifest、preload、loading/failure UI | content/ui/bootstrap        | 低速・404・fallback E2E合格       |

### Phase 5 — Racingサウンド

依存: Phase 1。映像アセット制作と並行可能。

| ID    | 作業                               | 主な変更先                 | 受け入れ条件                            |
| ----- | ---------------------------------- | -------------------------- | --------------------------------------- |
| E5-01 | 汎用continuous voice contract      | `engine/audio`             | update/fade/limit/dispose unit test合格 |
| R5-02 | master scoreを作曲データとして実装 | `racing/content/audio`     | tempo/length/loop構造検査合格           |
| R5-03 | 4世代のarrangement/patchを作る     | `arrangements.ts`          | OfflineAudio golden合格                 |
| R5-04 | phase維持するaudio director        | `racing/audio/director.ts` | 全切替組合せでtick一致                  |
| R5-05 | player/AIエンジン音                | `vehicle-sound.ts`         | RPM/pan/voice priority test合格         |
| R5-06 | ブレーキ音とrace cue               | `vehicle-sound.ts`、app    | trigger/hysteresis/priority test合格    |

### Phase 6 — 統合、操作感、UI

依存: Phase 4、Phase 5

| ID    | 作業                                                   | 受け入れ条件                               |
| ----- | ------------------------------------------------------ | ------------------------------------------ |
| R6-01 | bootstrapを新renderer/asset/audioへ切替                | 初期load、unlock、resize、pagehideが正常   |
| R6-02 | camera追従と視認性を4世代で調整                        | player/AI/次のcurveが判別可能              |
| R6-03 | HUDとloading/resultを内部解像度別に調整                | 256×224でも文字欠けなし                    |
| R6-04 | 世代切替transitionを統合                               | 状態・音楽位相維持、旧assetの安全なrelease |
| R6-05 | gamepad、keyboard、audio off、WebGL fallbackを実機確認 | QA matrix全項目合格                        |

### Phase 7 — 回帰、性能、文書化

依存: Phase 6

| ID    | 作業                                   | 受け入れ条件                   |
| ----- | -------------------------------------- | ------------------------------ |
| Q7-01 | root verifyと全Racing test             | 全件合格                       |
| Q7-02 | 4世代browser visual test               | 承認済みgoldenとの差分が閾値内 |
| Q7-03 | 4世代audio golden/measurement          | 無音・clip・位相ずれなし       |
| Q7-04 | CPU/GPU/heap/audio resource計測        | 下記budget合格、増加傾向なし   |
| Q7-05 | 境界・asset・shader preflight          | 違反0件                        |
| Q7-06 | `ENGINE_API.md`と`RACING_PROOF.md`更新 | 新APIと再利用証跡を反映        |

---

## 11. テスト計画

### 11.1 Unit / contract

| 対象        | 検査内容                                                                           |
| ----------- | ---------------------------------------------------------------------------------- |
| gameplay    | 現行10テスト、固定入力replay、世代切替前後のstate同一性                            |
| raster      | scanline table、clip、左右curve、buffer reuse、無効入力                            |
| affine      | UV origin/step、wrap/clamp、CPU参照sample                                          |
| model       | transform、instance、sort、quantize、missing attribute fallback                    |
| environment | reflection vector、cube face/equirect UV、intensity、fallback                      |
| assets      | dedupe、preload、失敗、cancel、reference count、context restore、dispose           |
| audio       | transport phase、arrangement、RPM curve、brake hysteresis、voice priority、dispose |
| generation  | capability、command dispatch、全12方向の世代切替組合せ                             |

### 11.2 Golden

- 4世代 × `start straight / left curve / right curve / AI near / result` の最低20画像
- rasterとaffineはGPU captureに加えて小サイズCPU参照画像を保持
- 第3世代はquantize/affine UVのon/off比較、第4世代はlight/environmentのon/off比較を保持
- audioは4世代各2小節、engine RPM 3点、brake開始/終了をmeasurementとして保存
- golden更新は理由と比較画像をreviewし、自動一括更新だけで承認しない

### 11.3 Browser E2E

1. cold loadし、必須assetの完了前にrace tickが進まないことを確認する。
2. countdown後に固定入力replayを開始する。
3. 走行中に第1→第2→第3→第4→第1世代へ切り替える。
4. 各切替直前・直後の論理state、music tick、active resource数を記録する。
5. 3周完走、result、restartまで進める。
6. resize、visibility復帰、audio mute/unmute、page disposeを確認する。

### 11.4 性能budget

計測機はPhase 0で固定し、次を初期budgetとする。達成困難な場合は測定結果と視覚差を添えて変更する。

| 指標               | 初期budget                                                   |
| ------------------ | ------------------------------------------------------------ |
| simulation         | 60 Hz固定、1 tick p95 2 ms未満                               |
| 第1・第2世代render | p95 16.7 ms未満                                              |
| 第3世代render      | p95 33.3 ms未満                                              |
| 第4世代render      | p95 16.7 ms未満（640×448内部解像度）                         |
| frame allocation   | steady stateで大きなtyped array/textureの毎frame確保なし     |
| load               | progressが表示され、失敗時にasset keyと回復操作を提示        |
| lifecycle          | restart 10回と全世代2往復後にactive resourceがbaselineへ戻る |

---

## 12. 依存関係と実装順

```text
Phase 0: 仕様・baseline
        │
        ▼
Phase 1: command / asset contract
        │
        ├──────────────┐
        ▼              ▼
Phase 2: raster/affine  Phase 3: 3D/environment
        │              │
        └──────┬───────┘
               ▼
Phase 4: assets / presentation
               │
Phase 5: audio ─┤  （Phase 1後から並行可能）
               ▼
Phase 6: integration / UI
               │
               ▼
Phase 7: QA / documentation
```

最初の重要ゲートはPhase 1である。render commandとasset handleを確定する前に画像・モデルを量産すると、
寸法、UV、texture形式、material情報の作り直しが発生する。Image Genのstyle検討は先行できるが、sprite sheet化と
3D exportはcontract確定後に行う。

---

## 13. リスクと対策

| リスク                                   | 影響                       | 対策                                                   |
| ---------------------------------------- | -------------------------- | ------------------------------------------------------ |
| 原仕様のモデル世代が曖昧                 | 大量のasset作り直し        | Phase 0で最優先確定、代表1asset承認後に量産            |
| 1つのcanvasで2D/3D contextを混在できない | renderer構成の手戻り       | 内部render targetと最終compositeをPhase 1で先に実証    |
| raster/affine APIがRacing専用化する      | engine再利用性低下         | scanline tableとUV matrixだけをengine contractにする   |
| glTF loader対応外のexport                | model欠落・runtime failure | export preset、preflight、fixtureをasset制作前に固定   |
| 環境マップが低性能GPUで重い              | 第4世代のframe落ち         | 解像度・sample方式・light数の段階的fallback            |
| BGM切替で位相がずれる                    | 世代切替の体験悪化         | audio timeを正本にし、OfflineAudio testを先行          |
| engine音がvoice limitを占有する          | BGM/SFX欠落                | priority、voice pool、AI距離減衰、世代別上限test       |
| 生成画像の角度・車種が不統一             | sprite切替がちらつく       | style frame、固定配色、角度表、sheet化前の目視QA       |
| 世代別builderが物理へ分岐を持つ          | 切替で挙動が変わる         | `RaceState`読取専用化とmutation test                   |
| 新rendererがConsole Chaosを壊す          | workspace全体の回帰        | 既存rendererを残し、root verifyとparityを各Phaseで実行 |

---

## 14. レビュー単位とコミット方針

- engine API、各描画機能、Racing presentation、audio、asset追加を別review単位にする。
- 生成binaryだけの変更とruntime code変更を可能な限り分離する。
- golden更新には、変更理由、旧/新比較、許容差を含める。
- 1つの変更で全4世代を同時に書き換えず、共通contractの後に世代ごとの縦切りを完成させる。
- 各review時に`npm run verify`、対象browser capture、resource countを記録する。

推奨する縦切り順は「第1世代 → 第2世代 → 第3世代 → 第4世代」である。ただしengine実装は
Phase 2とPhase 3を並行できる。各世代はasset、frame builder、画像golden、実ブラウザ確認までを1単位とし、
未完成の4世代を長期間同時に抱えない。

---

## 15. 最終チェックリスト

### Engine

- [ ] raster scrollが公開APIと少なくとも2つのbackend testを持つ
- [ ] affine planeが公開API、CPU参照、shader testを持つ
- [ ] model instanceとenvironment mapが公開API、fallback、lifecycle testを持つ
- [ ] hardware profileの既存値が意図せず変化していない
- [ ] engineにRacing固有語彙・asset path・世代別アートがない

### Racing

- [ ] 既存走行・AI・ラップ・順位・result・restartが維持されている
- [ ] 4世代の表現が受け入れ条件を満たす
- [ ] Image Gen由来assetのstyle、透明度、palette、seam検査が合格する
- [ ] 第3・第4世代のmodel preflightとbudget検査が合格する
- [ ] BGM、engine音、brake音、race cueが4世代で動作する
- [ ] 世代切替時に論理stateとmusic phaseが維持される

### QA / Docs

- [ ] 現行10テストを含む全自動検査が合格する
- [ ] 4世代の画像・音声goldenがreview済みである
- [ ] keyboard/gamepad、audioなし、fallback環境を確認する
- [ ] 性能・resource lifecycle budgetを満たす
- [ ] `ENGINE_API.md`と`RACING_PROOF.md`が実装結果に更新されている
