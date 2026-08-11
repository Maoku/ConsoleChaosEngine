# Console Chaos Racing リニューアル改修計画書

> 本書は [RENEWAL_RECING_GAME.md](RENEWAL_RECING_GAME.md) を、Console Chaos の完全移行後に更新された
> `@console-chaos/engine` の実装へ合わせて再計画した改訂第2版である。
>
> 改訂日: 2026-08-11  
> 調査基準: `38d7be4`（`main`、worktree clean）  
> 対象: `packages/engine`、`packages/engine-testkit`、`apps/racing`

---

## 1. 再計画の結論

前版の策定後、Console Chaos Engineには次の基盤が実装済みになった。

- 世代別FBO、palette/RGB555、CRT、旧・新2世代transitionを持つproduction WebGL renderer
- texture、sprite atlas、static/skinned glTF、material、light、backgroundを扱う`RenderFrame v2`
- PS1風vertex quantize、affine texture、triangle sort
- PS2向けdepth bufferと動的point light
- CPU/GPU assetの参照管理、重複load防止、WebGL context restore、dispose
- 4世代音源、voice limit、位相を維持したBGM切替を持つgeneration audio service
- GameHostのtwo-phase fixed tick、ActionMap、世代切替、production lifecycle

したがって、前版に含めていた「新しいcomposite renderer」「model command」「asset lifecycle」
「世代別BGM基盤」の新規構築は不要である。

今回の改修は次の4本に絞る。

1. Racingを既存production WebGL rendererとgeneration audio serviceへ移す。
2. 現行generation pipelineへ、汎用raster surfaceとaffine surfaceのpassを追加する。
3. 既存3D rendererを拡張し、directional/ambient lightとenvironment mapを実際に描画する。
4. 1つの`RaceState`から4世代のpresentationと音を構築し、切替中も状態と音楽位相を維持する。

---

## 2. 仕様の解釈

### 2.1 世代別の完成像

| 世代            | 表現                                   | 主なアセット                                | 利用するEngine機能                                  |
| --------------- | -------------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| 第1世代 / `FC`  | 車体背後視点のラスタースクロール疑似3D | Image Gen製sprite、road strip、背景         | 新規raster surface、既存FC palette/sprite plane/CRT |
| 第2世代 / `SFC` | アフィン変換地面による疑似3D           | Image Gen製sprite、seamless road tile、背景 | 新規affine surface、既存RGB555/sprite plane/CRT     |
| 第3世代 / `PS1` | 低ポリゴン3Dレース                     | 低poly glTF/GLB、低解像度texture            | 既存model、quantize、affine texture、sort           |
| 第4世代 / `PS2` | lightと環境反射を持つ3Dレース          | 高詳細glTF/GLB、environment texture         | 既存model/depth + 拡張light/environment map         |

原仕様のモデル節には「第1、第2世代は Image Gen」と「第1、第2世代は3Dメッシュ」が併記されている。
本計画では後者を「第3、第4世代は3Dメッシュ」の誤記と仮定する。Phase 0で確定し、異なる場合は
アセット方式だけを変更する。

### 2.2 全世代で共有する論理状態

- コース中心線、幅、チェックポイント、スタート位置
- 60 Hz固定の車両運動、路外減速、境界拘束、復帰
- 3秒カウントダウン、3周、1人対1AI、順位、リザルト、リスタート
- ActionMapから得るsteer、accelerate、brake、reset、generation switch
- 1曲のtempo、小節構造、transport位置

世代切替はpresentationと音源だけを変更する。車両位置、速度、heading、lap、AI、race tickを再生成しない。

### 2.3 非目標

- 新しいrenderer/pipeline/AssetManager/AudioEngineの作り直し
- 複数コース、車種選択、チューニング、ネットワーク対戦
- 高度なタイヤ・サスペンション物理
- PBR一式、normal map、shadow map、IBL prefilterなどの汎用material system
- runtime asset streaming。1コース分は起動時にpreloadし、終了時に一括解放する
- Console Chaos本編の見た目・ゲーム内容・goldenの変更

---

## 3. 更新後の実装baseline

### 3.1 Engineで完成済みの機能

| 領域        | 現在の実装                                                      | Racingでの扱い                      |
| ----------- | --------------------------------------------------------------- | ----------------------------------- |
| lifecycle   | GameHost、`prepareFixedUpdate`→generation advance→`fixedUpdate` | そのまま使用                        |
| generation  | 4 profiles、2世代transition、capability値                       | そのまま使用し2能力だけ追加         |
| input       | keyboard/gamepad ActionMap、短時間edge保持                      | 現行Racing実装を維持                |
| RenderFrame | mesh、skinned mesh、sprite、light、background、material         | 世代別commandへ再構成               |
| WebGL       | 4世代target、postfx、transition、context restore                | production rendererとして採用       |
| 3D          | glTF/GLB、texture、animation、quantize、affine UV、sort、depth  | 第3・第4世代で再利用                |
| asset       | image/glTF/GPU handle、dedupe、ref-count、restore               | Racing用TypeScript manifestだけ追加 |
| audio       | 4 voice source、Score、MusicClock、位相維持、one-shot           | BGMと効果音に使用                   |
| testkit     | manual loop、recording renderer/audio                           | 新しいcontract/E2Eで拡張            |

### 3.2 Engineで未完成または宣言のみの機能

| 項目                     | 現状                                                                           | 必要な改修                                              |
| ------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| raster scroll            | transition shaderの走査線glitchのみ。ゲーム画面用surfaceはない                 | 汎用raster surface commandとWebGL pass                  |
| affine plane             | profileの`affinePlane`とtextured quadはあるが、画面空間の疑似3Dsurfaceはない   | UV origin/stepを受けるaffine surface pass               |
| `MaterialCommand.uvMode` | 型はあるがrendererはprofileの`affineTexture`だけを見る                         | 今回は3D用profile値を正本とし、surfaceとは分離          |
| light                    | point lightを1つ使用。directional/ambientの型はあるがrendererは固定lightを使う | 宣言済みLightCommandをrendererへ接続                    |
| normal/emissive texture  | 型はあるがproduction shaderでは未使用                                          | 今回は依存しない。必要になるまで非目標                  |
| environment map          | command、asset意味、shaderがない                                               | equirectangular mapとreflection strengthを最小追加      |
| overlay                  | Canvas rendererは描画するがWebGL rendererは描画しない                          | Racing HUDをapp所有DOMへ移す                            |
| continuous audio         | generation audioはScore/one-shot中心                                           | まず短いoverlap one-shotで実証し、品質不足時のみAPI拡張 |

### 3.3 Racingの現状

維持するもの:

- `car.ts`: 決定的な加速、ブレーキ、ステア、後退、路外減速、復帰
- `track.ts`: 閉じた中心線、最近点、接線、進捗
- `lap.ts`: 順序付きcheckpoint、正方向通過、lap time
- `ai.ts`: 決定的path following
- `race.ts`: countdown、3周、順位、result、restart
- `actions.ts`: keyboard/gamepad binding
- `app.ts`: two-phase fixed tickとgeneration request

置き換えるもの:

- `createCanvasCommandRenderer()`を使用する`bootstrap.ts`
- 全世代共通のpolylineコース・矩形spriteを作る`presentation/frame.ts`
- 色とcamera zoomだけの`config/themes.ts`
- `playTone()`だけのrace cue
- WebGL production rendererでは表示されない`RenderFrame.overlays`依存HUD

### 3.4 再計画時の検証結果

2026-08-11、基準commit `38d7be4`で次を確認した。

| 検査                    | 結果                              |
| ----------------------- | --------------------------------- |
| Engine unit             | 5 files / 19 tests pass           |
| Engine testkit          | 1 file / 1 test pass              |
| Racing unit             | 4 files / 9 tests pass            |
| Racing E2E              | 1 file / 1 test pass              |
| Racing production build | pass、JS 36.38 kB / gzip 14.19 kB |
| root `npm run verify`   | pass、54 files / 438 tests        |
| Console bundle gate     | pass、3 chunks / 170,300 bytes    |

Engine・testkit・Racingの30 testとRacing buildを日常の最小baselineとし、各フェーズの完了時には、
境界・移行・asset・production build検査とworkspace全体の438 testを含むroot `npm run verify`も通す。

---

## 4. 完了条件

### 4.1 ゲーム

- 4世代すべてでcountdownから3周完走、順位、result、restartまで操作できる。
- 世代切替前後でposition、speed、heading、lap、checkpoint、AI、race tickが一致する。
- keyboard/gamepadのsteer、accelerate、brake、reset、世代切替が動作する。
- 現行の決定的replay結果が変化しない。

### 4.2 映像

- 第1世代は背後視点のraster roadであり、現行top-down polylineに見えない。
- 第2世代は地平線以下のaffine surfaceとsprite車両で疑似3Dを表現する。
- 第3世代は実glTF meshを使い、quantize、affine texture、depthなしsortが確認できる。
- 第4世代はdepth、frame指定light、environment reflectionを同時に確認できる。
- transition中は旧世代と新世代がそれぞれのcommandで描画され、論理位置が飛ばない。
- FC/SFCのsurfaceとspriteが既存palette/RGB555/CRT passを通る。

### 4.3 音

- 同じ曲が4つの世代別arrangement/sourceで鳴る。
- 世代切替前後のbar position誤差が既存engine基準の1e-9以下である。
- player車の音程・音量が速度に追従し、停止・中速・最高速を判別できる。
- 一定速度以上のbrake入力でのみbrake音が鳴り、voice数が増え続けない。
- countdown、start、lap、finish cueが世代別sourceを通る。

### 4.4 境界と回帰

- Engineにcar、race、track、lapなどRacing固有語彙を追加しない。
- Racingは`@console-chaos/engine`の公開入口だけを使う。
- Engineの新しいsurface/environment機能はConsole Chaos command goldenを変更しない。
- Console Chaosのstate/render/audio/lifecycle goldenとroot `npm run verify`が合格する。
- restart 10回、全世代2往復、dispose後にAssetManager active/GPU resourceがbaselineへ戻る。

---

## 5. 改修アーキテクチャ

### 5.1 既存pipelineへ追加する

新rendererは作らず、既存`createGenerationWebGlRenderer()`と`createGenerationPipeline()`を拡張する。

```text
RaceState
   │
   ▼
RaceVisualState
   │
   ├── FC commands  ── raster surface + sprite
   ├── SFC commands ── affine surface + sprite
   ├── PS1 commands ── glTF mesh/material
   └── PS2 commands ── glTF mesh/material/light/environment
                         │
                         ▼
background → surface → mesh → sprite → palette/CRT → transition compose
```

surface passは世代別scene targetへ描く。したがって既存quantize、CRT、transitionを迂回しない。

### 5.2 RenderFrameの最小拡張

既存のmesh/model/sprite commandを置き換えず、2種類のscreen surfaceだけを追加する。

```ts
interface RasterSurfaceCommand {
  id: string;
  generations?: readonly GenerationId[];
  texture: string;
  screenRect: readonly [number, number, number, number];
  scanlines: Float32Array;
  // 1行あたり sourceCenterX / sourceWidth / sourceY / brightness
}

interface AffineSurfaceCommand {
  id: string;
  generations?: readonly GenerationId[];
  texture: string;
  screenRect: readonly [number, number, number, number];
  uvOrigin: Vec2;
  uvStepX: Vec2;
  uvStepY: Vec2;
  wrap?: "repeat" | "clamp";
}

interface MaterialCommand {
  // 既存fieldに追加
  environmentTexture?: string;
  environmentStrength?: number;
}

interface LightCommand {
  // 既存fieldに追加。directionalのときだけ使用
  direction?: Vec3;
}
```

`RenderFrame.reset()`、recording renderer、command golden serializerも新配列を扱う。
`Float32Array`はpresentationが保持して再利用し、steady stateで毎frame確保しない。

### 5.3 hardware capability

`HardwareGenerationProfile.video`へ次を追加する。

- `rasterScroll: boolean`: FCのみtrue
- `environmentMap: boolean`: PS2のみtrue

SFCは既存`affinePlane`を利用する。PS1の3D texture歪みは既存`affineTexture`を利用し、
`affinePlane`と混同しない。

rendererはgeneration IDを直接比較せず、commandのgeneration maskとprofile capabilityの両方を確認する。

### 5.4 raster surface

Racing側が各scanlineの道路中心、幅、texture位置、brightnessを計算し、Engineは値の意味を解釈せず描画する。

Engineの責務:

- table長、screen rect、有限値、source widthのvalidation
- scanline lookup textureまたはdynamic bufferの再利用
- clip、nearest sampling、profile filter適用
- scene targetへの描画とcontext restore

Engineへroad、curve、steering、speedの概念を入れない。

### 5.5 affine surface

Racing側が車両位置・headingから`uvOrigin/uvStepX/uvStepY`を作る。Engineは画面の各pixelに対して
線形UVを生成し、repeat/clampでtextureをsampleする。

- horizonより上は既存`BackgroundCommand`
- horizonより下は`AffineSurfaceCommand`
- 車両・trackside objectは既存`SpriteCommand`
- surfaceはSFC sprite planeの下に描き、最後にRGB555/CRTを適用

### 5.6 3D、light、environment

第3・第4世代は既存`MeshCommand.asset`と`RenderAssetManifest.models`を使う。新しいModelCommandは作らない。

light改修:

- `ambient` commandから環境光色・強度を取得
- `directional` commandから方向・色・強度を取得
- 既存`point` commandは最も優先度の高い1灯を維持
- commandがない場合は現在の固定light値へfallbackし、Console goldenを維持

environment改修:

- 既存`RenderTextureAsset`でequirectangular 2D textureをpreload
- world normal、world position、camera positionからreflection vectorを計算
- equirectangular UVへ変換し、base colorへ`environmentStrength`で合成
- `profile.video.environmentMap === false`ならstrengthを0にする
- roughness mip、normal map、metallic workflowは今回追加しない

### 5.7 transitionとcamera

1つの`RenderFrame`へ4世代分のcommandをgeneration mask付きで積む。既存pipelineが通常1世代、
transition中2世代を選択する。

raster/affineはscreen-spaceなのでworld cameraを使用しない。PS1/PS2は共通の背後追従cameraを使用する。
このため、現段階では世代別camera APIを追加しない。visual reviewで切替中の構図が成立しない場合だけ、
互換fallback付きcamera variantを別変更として検討する。

### 5.8 HUD

production WebGL rendererは`RenderFrame.overlays`を描画しない。Console Chaosと同様にRacing HUDを
app所有DOMへ移す。

- generation label、lap、rank、time、countdown、result、restart案内
- 256×224相当の小画面でも欠けないCSS
- `aria-live`はstart、lap、finishだけに限定
- animationやpalette postfxはworld renderingと分離

Engineのoverlay renderer追加は今回の非目標とする。

---

## 6. 世代別のRacing実装

### 6.1 共通presentation state

`RaceState`を読み取り専用の`RaceVisualState`へ投影する。

- player/AI position、heading、speed、normalized RPM
- track sample、前方曲率、次checkpoint、course progress
- camera-relative distanceと左右位置
- race phase、lap、rank、time
- animation time

各世代builderは`RaceState`を変更してはならない。mutation testで固定する。

### 6.2 第1世代

Racing側:

- player前方の中心線を一定距離ごとにsample
- 各scanlineのroad center/width/sourceY/brightnessへ変換
- speedで路面phase、curveで左右offset、steerでcamera biasを更新
- playerは画面下部の後方sprite、AIは距離段階別sprite

Engine側:

- `RasterSurfaceCommand`のvalidationとdraw pass
- FC scene/sprite分離、fixed54 palette、sprite limit、RF/CRTとの統合

受け入れ条件:

- stop、straight、left curve、right curve、off-trackのscanline goldenが一致
- 256×224 captureでhorizon、road edge、player、AIが所定位置
- scanline bufferの毎frame確保がない

### 6.3 第2世代

Racing側:

- course座標をroad tile UVへ投影
- headingとprogressからaffine matrixを更新
- player/AIは方向・距離別sprite atlasを使用
- road、grass、curbを1枚のseamless tileへまとめる

Engine側:

- `AffineSurfaceCommand`のCPU参照式とWebGL shader
- SFC scene/sprite分離、RGB555、composite/CRTとの統合

受け入れ条件:

- 既知matrixの四隅・中央UVがCPUとGPUで一致
- tile seamがなく、旋回時に地面が正しい向きへ回る
- FC raster passを使用せず成立

### 6.4 第3世代

- 低poly車両とコースGLBを既存manifestへ登録
- small atlas、nearest filter、少materialを使用
- materialは`polygonSort: true`、profileは既存quantize/affine texture/depthなしを適用
- cameraはplayer背後追従、表示揺れはpresentationだけで加える

受け入れ条件:

- 通常経路で2D矩形fallbackを使わない
- quantizeとaffine UVが走行中に視認できる
- 同一replayのcommand順とframe captureが決定的
- glTF preflightとtriangle/texture budgetに合格

### 6.5 第4世代

- 第3世代より詳細な車両・コースGLBとmesh normalを用意
- ambient、directional、必要ならpoint lightをframeへ積む
- 車体materialだけにenvironment texture/strengthを設定
- road、HUD、透明spriteには反射を一律適用しない

受け入れ条件:

- camera/車体headingを変えると反射位置が連続して変化
- directional light変更でdiffuseが変化
- PS1へ切り替えるとenvironmentとdynamic lightが無効
- 640×448内部解像度で性能budgetを満たす

---

## 7. アセット計画

### 7.1 Racing manifest

runtime JSON loaderは増やさず、Console Chaosと同じTypeScript catalog patternを使う。

```text
apps/racing/src/presentation/catalog.ts
apps/racing/public/assets/
  gen1/
    sprites/
    backgrounds/
    road/
  gen2/
    sprites/
    backgrounds/
    tiles/
  gen3/
    models/
    textures/
  gen4/
    models/
    textures/
    environment/
```

`createRacingRenderManifest()`がtextures、models、atlases、geometries、fallbackTexturesを返し、
`createGenerationWebGlRenderer()`が4世代分を起動時にpreloadする。

### 7.2 Image Genを使う第1・第2世代

アセット制作時にImage Genスキルを使用する。最初に共通車種・配色・コース景観を示すstyle frameを承認し、
その後にsprite/textureを生成する。

必要物:

- player/AIのrear、rear-left、rear-rightと距離段階
- FC road strip、curb、roadside、遠景
- SFC seamless road/grass/curb tile、遠景、trackside sprite
- alpha、pixel grid、palette、tile seam、atlas metadata

生成結果は確定PNG/WebPとして保存し、runtime生成に依存しない。

### 7.3 第3・第4世代

- glTF 2.0 / GLB、meter単位、forward axis、origin、UV規約を固定
- 第3世代は数千triangle/台、256px級atlasを暫定上限
- 第4世代は数万triangle未満/台、1024px級atlasを暫定上限
- collisionの正本は既存track centerlineで、render meshをphysicsへ流用しない
- representative assetを測定後に正式budgetを固定

---

## 8. サウンド計画

### 8.1 既存generation audioの採用

`bootstrap.ts`を`createGenerationAudioService()`へ切り替える。`RacingAudioPresenter`は
Consoleのpresenter patternと同様に、profileに応じたarrangementを`playScore/useScore`へ渡す。

| 世代 | arrangement                        |
| ---- | ---------------------------------- |
| FC   | PSG、少発音、noise percussion      |
| SFC  | BRR sample、8 voice以内            |
| PS1  | ADPCM、drum/bass、左右定位         |
| PS2  | streaming、48 kHz、広い定位/reverb |

旋律、tempo、小節数、loop長は共通にする。

### 8.2 車両音

Phase 0で既存`playOneShot()`によるoverlap方式を先に実証する。

- 20 Hz程度で80〜120 msの短音を重ねる
- `frequency`をnormalized speed/RPMから補間
- `velocity`をthrottleとspeedから補間
- playerを優先し、AIは距離減衰と低い更新率
- brakeは速度・入力thresholdとhysteresisを持つnoise系one-shot

次のどれかに該当する場合だけ、Engineへparameterized continuous voice APIを追加する。

- steady speedで可聴な無音gapが残る
- FCの5 voiceでBGMまたは必須cueを継続的に奪う
- 1秒あたりのvoice生成・GCが性能budgetを超える

API拡張が必要な場合も`rpm`や`engine sound`というRacing語彙は入れず、
`startSustainedVoice/updateVoice/stopVoice`の汎用contractにする。

### 8.3 音声受け入れ条件

- OfflineAudioContextで4世代各2小節に無音窓・clipがない
- 全12方向の世代切替でbar position誤差1e-9以下
- 0/50/100% speedの主周波数とgainが定義範囲内
- brake trigger/hysteresisが決定的
- finish cueがlap/start/countdownより優先
- dispose後にactive/scheduled voiceが0

---

## 9. 目標ファイル構成

```text
packages/engine/src/
  generation/profiles.ts
  render/
    frame.ts
    generation-pipeline.ts
    webgl-renderer.ts
    raster/
      validate.ts
      pass.ts
      shader.ts
    affine/
      reference.ts
      pass.ts
      shader.ts
    environment/
      mapping.ts
      shader.ts
  tests/
    surface-render.test.ts
    environment-render.test.ts

apps/racing/src/
  app.ts
  bootstrap.ts
  config/
    actions.ts
    themes.ts
  content/
    track.ts
    audio/
      score.ts
      arrangements.ts
      cues.ts
  presentation/
    catalog.ts
    visual-state.ts
    frame.ts
    gen1-raster.ts
    gen2-affine.ts
    gen3-low-poly.ts
    gen4-environment.ts
  audio/
    presenter.ts
    vehicle-sound.ts
  ui/
    hud.ts
    loading.ts
```

`webgl-renderer.ts`をさらに肥大化させないよう、新shader/passの作成と純粋な計算は専用directoryへ置く。
既存rendererはcommand dispatch、asset binding、pass順の統合だけを担当する。

---

## 10. 実装フェーズ

### Phase 0 — 仕様確定と技術spike

| ID    | 作業                                      | 完了条件                            |
| ----- | ----------------------------------------- | ----------------------------------- |
| P0-01 | 3D meshの対象世代を確定                   | 原仕様と本書の表が一致              |
| P0-02 | baseline test/build/browser captureを保存 | commit、結果、browser/GPU情報を記録 |
| P0-03 | 現行pipeline上でraster 1面を描くspike     | FC postfx/transitionを通る          |
| P0-04 | affine UV CPU式とshader prototype         | sample点が一致                      |
| P0-05 | equirect reflection prototype             | normal/camera別の期待UVと一致       |
| P0-06 | overlap one-shot車両音を試聴・測定        | continuous API要否を記録            |
| P0-07 | 4世代style frameとHUD方針を確定           | Image Gen/3D量産前の承認            |

### Phase 1 — Racingをproduction Engineへ移行

依存: P0-02、P0-07

| ID    | 作業                                            | 主な変更先                | 完了条件                                    |
| ----- | ----------------------------------------------- | ------------------------- | ------------------------------------------- |
| R1-01 | Racing render catalogとplaceholder asset        | `presentation/catalog.ts` | 全manifest asset preload成功                |
| R1-02 | WebGL rendererへbootstrap変更                   | `bootstrap.ts`            | context restore/disposeを既存contractで通過 |
| R1-03 | polyline/circle依存をbox/quad placeholderへ変換 | presentation              | 4世代がWebGLで起動                          |
| R1-04 | HUDをDOMへ移す                                  | `ui/hud.ts`、HTML/CSS     | countdown〜resultが表示                     |
| R1-05 | generation audio serviceへ変更                  | bootstrap/audio           | sourceが4世代で切り替わる                   |
| R1-06 | production lifecycle E2E追加                    | tests/e2e                 | boot/switch/race/dispose合格                |

このフェーズでは最終アートを要求しない。既存production serviceへRacingを接続し、後続機能の検証経路を先に固定する。

### Phase 2 — Engineの最小機能拡張

依存: Phase 0 spike、Phase 1

| ID    | 作業                                         | 主な変更先           | 完了条件                        |
| ----- | -------------------------------------------- | -------------------- | ------------------------------- |
| E2-01 | raster/environment capability追加            | profiles             | profile/parity test合格         |
| E2-02 | RenderFrame surface/material field追加       | frame/testkit        | reset/record/serialize test合格 |
| E2-03 | raster validation、buffer reuse、shader pass | render/raster        | CPU値・GPU golden合格           |
| E2-04 | affine reference、shader pass                | render/affine        | UV contract/golden合格          |
| E2-05 | surfaceをgeneration pipelineへ統合           | pipeline/renderer    | palette/CRT/transitionを通過    |
| E2-06 | ambient/directional LightCommandを接続       | renderer/shader      | command有無のlight test合格     |
| E2-07 | environment mappingを追加                    | renderer/environment | reflection/fallback test合格    |
| E2-08 | context restore/resource test拡張            | asset/GL tests       | 10 restore後もresource一定      |
| E2-09 | Console回帰確認                              | root verify          | command/state/PCM golden不変    |

### Phase 3 — 第1・第2世代

依存: Phase 2。Image Gen制作はsurface contract確定後に開始する。

| ID    | 作業                                          | 完了条件                        |
| ----- | --------------------------------------------- | ------------------------------- |
| R3-01 | 共通`RaceVisualState`                         | RaceState非変更test合格         |
| R3-02 | FC style frameからsprite/road/background生成  | alpha/palette/寸法検査合格      |
| R3-03 | FC raster builder                             | 5状態scanline/image golden合格  |
| R3-04 | SFC style frameからsprite/tile/background生成 | RGB555/seam/atlas検査合格       |
| R3-05 | SFC affine builder                            | UV/image golden合格             |
| R3-06 | AI距離・occlusion・sprite優先度               | player/AIを全状態で判別可能     |
| R3-07 | FC↔SFC transition                             | state不変、旧新画面の両方を描画 |

### Phase 4 — 第3・第4世代

依存: Phase 1、E2-06、E2-07。3D asset制作はPhase 3と並行可能。

| ID    | 作業                             | 完了条件                         |
| ----- | -------------------------------- | -------------------------------- |
| R4-01 | PS1 low-poly car/course asset    | preflight/budget合格             |
| R4-02 | PS1 frame builder/material       | quantize/affine/sort golden合格  |
| R4-03 | PS2 car/course/environment asset | preflight/budget/color space合格 |
| R4-04 | PS2 frame builder/light/material | light/reflection golden合格      |
| R4-05 | 4世代commandを同一frameへ統合    | 全12切替で構図・state正常        |
| R4-06 | renderer statsとbudget検査       | triangle/frame budget合格        |

### Phase 5 — BGM、車両音、cue

依存: R1-05、P0-06。Phase 3/4と並行可能。

| ID    | 作業                           | 完了条件                             |
| ----- | ------------------------------ | ------------------------------------ |
| R5-01 | master score                   | tempo/loop/track validation合格      |
| R5-02 | 4世代arrangement               | OfflineAudio golden合格              |
| R5-03 | audio presenter                | 全世代source/arrangement切替合格     |
| R5-04 | player/AI vehicle sound        | speed/pan/voice priority test合格    |
| R5-05 | brake soundとrace cue          | trigger/hysteresis/priority test合格 |
| R5-06 | 必要時のみcontinuous voice API | P0-06の失敗条件解消                  |

### Phase 6 — 統合、QA、文書化

依存: Phase 3、4、5

| ID    | 作業                                    | 完了条件                              |
| ----- | --------------------------------------- | ------------------------------------- |
| Q6-01 | 3周完走E2Eを4世代で実行                 | gameplay/result/restart合格           |
| Q6-02 | 固定replay中の全世代切替                | state/audio phase不変                 |
| Q6-03 | 4世代画像・音声golden                   | 承認済み差分のみ                      |
| Q6-04 | keyboard/gamepad/audioなし/fallback確認 | QA matrix合格                         |
| Q6-05 | restart/context restore/dispose stress  | resource leak 0                       |
| Q6-06 | 性能計測                                | 下記budget合格                        |
| Q6-07 | docs更新                                | ENGINE_API/RACING_PROOFへ実装結果反映 |
| Q6-08 | root verifyとproduction build           | 全検査合格                            |

---

## 11. テスト計画

### 11.1 Engine contract

- raster tableの長さ、有限値、clip、buffer reuse、generation mask
- affine UVのorigin/step、repeat/clamp、CPU/GPU一致
- surfaceの描画順とFC/SFC sprite plane合成
- transition中に旧・新surfaceを各1回描画
- environment reflection vectorとequirectangular UV
- environment capability off、textureなし、strength 0のfallback
- ambient/directional/point lightの選択と固定light fallback
- context loss/restore 10回と最終release
- RenderFrame reset、testkit recording、serialization

### 11.2 Racing unit

- 現行9 unit testを維持
- `RaceVisualState`がRaceStateを変更しない
- FC scanline tableの直線/左右curve/off-track
- SFC matrixのheading/progress変化
- 4世代builderの必須command/asset key
- HUD stateとrace phase
- vehicle sound frequency/gain、brake hysteresis
- 世代切替前後のstate snapshot一致

### 11.3 Browser/golden

- 4世代 × start straight / left / right / AI near / resultの最低20画像
- PS1 quantize/affine texture on、PS2 light/environment onの比較画像
- 4世代各2小節のPCM measurement
- cold load、404、audio unlock failure、WebGL context restore
- countdown→race→3 laps→result→restart
- FC→SFC→PS1→PS2→FCの連続切替

golden更新は旧・新比較と理由をreviewし、自動更新だけで承認しない。

---

## 12. 性能・resource budget

計測機はPhase 0で固定する。

| 指標          | 初期budget                                                         |
| ------------- | ------------------------------------------------------------------ |
| simulation    | 60 Hz、1 tick p95 2 ms未満                                         |
| FC/SFC render | p95 16.7 ms未満                                                    |
| PS1 render    | p95 33.3 ms未満                                                    |
| PS2 render    | p95 16.7 ms未満、640×448内部解像度                                 |
| transition    | 2世代描画中p95 33.3 ms未満                                         |
| allocation    | scanline typed array、texture、shaderのsteady-state毎frame確保なし |
| shader        | 起動時compile。generation switch時のcompile 0                      |
| asset         | restart 10回、restore 10回、dispose後active/GPU 0                  |
| audio         | active voiceがprofile上限内、dispose後scheduled voice 0            |

---

## 13. 依存関係

```text
Phase 0: spec / spike
        │
        ▼
Phase 1: Racing production Engine integration
        │
        ▼
Phase 2: minimal Engine extensions
        │
        ├─────────────┐
        ▼             ▼
Phase 3: FC/SFC       Phase 4: PS1/PS2
        │             │
        └──────┬──────┘
               │
Phase 5: audio ┤  （Phase 1後から並行可能）
               ▼
Phase 6: integration / QA / docs
```

最初の実装ゲートはPhase 1である。Racingをproduction WebGL/audioへ移す前に最終assetを量産しない。
次のゲートはPhase 2のsurface/material contractであり、Image Genのsheet化と3D material exportは
このcontract確定後に行う。

---

## 14. 前版から削除・変更した作業

| 前版の計画                                     | 再計画                                                 |
| ---------------------------------------------- | ------------------------------------------------------ |
| 新しいcomposite/generation rendererを作る      | 既存`createGenerationWebGlRenderer`へpassを追加        |
| ModelCommandを新設                             | 既存`MeshCommand.asset`とglTF loaderを使用             |
| AssetManager/manifest loaderを新設             | 既存AssetManagerとTypeScript RenderAssetManifestを使用 |
| 旧・新世代assetを都度load/release              | 1コース分を起動時preload、renderer dispose時に解放     |
| 3D upload、quantize、affine UV、sortを新規実装 | 完成済み機能をそのまま使用                             |
| BGM clockと4音源を新規実装                     | 完成済みgeneration audio serviceへRacingのScoreを渡す  |
| WebGL overlay passを追加                       | Racing HUDをapp所有DOMへ移す                           |
| normal/roughnessを含むmaterial拡張             | equirect map + reflection strengthだけを追加           |
| 世代別camera APIを追加                         | raster/affineはscreen-space、PS1/PS2は共通cameraで回避 |

この削減により、Engine変更は既存pipelineの差分としてreviewでき、Console Chaos回帰の範囲も限定できる。

---

## 15. リスクと対策

| リスク                                     | 対策                                                   |
| ------------------------------------------ | ------------------------------------------------------ |
| surface passが既存palette/sprite合成を壊す | scene targetへ描き、postfx前後のgoldenを固定           |
| transitionで旧世代commandが欠ける          | 1 frameへ4世代分を積み、generation mask contractをtest |
| raster tableの転送がGC/GPU stallを起こす   | typed array/buffer再利用、p95計測                      |
| `uvMode`など宣言だけのfieldへ誤依存        | 実際にrendererが読むfieldだけをacceptance testで固定   |
| environment shaderがPS1/Consoleへ影響      | capability offでuniform 0、固定golden不変を検査        |
| LightCommand接続でConsoleの陰影が変わる    | commandなしは現行固定lightへfallback                   |
| WebGL移行でRacing HUDが消える              | Phase 1で先にDOM HUDへ移行                             |
| one-shot車両音が途切れる                   | Phase 0で測定し、失敗時のみ汎用continuous API          |
| Image Genの車種・角度が不統一              | style frame、角度表、代表sheet承認後に量産             |
| glTF exportがloader subset外               | export presetとpreflightを最初の代表modelで固定        |
| Racing変更がEngine boundaryを侵食          | boundary checkerへ新command fixtureを追加              |

---

## 16. 最終チェックリスト

### Engine

- [ ] raster surfaceとaffine surfaceが公開API、GPU pass、contract testを持つ
- [ ] surfaceが既存FC/SFC postfxとtransitionを通る
- [ ] ambient/directional LightCommandが実際にrendererへ反映される
- [ ] environment mapがPS2だけで有効になり、fallbackがある
- [ ] context restore、dispose、resource countが既存contractを維持する
- [ ] Consoleのstate/render/audio goldenが不変

### Racing

- [ ] production WebGL rendererとgeneration audio serviceを使用する
- [ ] 既存走行・AI・lap・rank・result・restartを維持する
- [ ] 4世代の映像が仕様の表現方式で明確に区別できる
- [ ] Image Gen assetのalpha/palette/seam/atlas検査が合格する
- [ ] PS1/PS2 modelのpreflightとbudget検査が合格する
- [ ] BGM、vehicle sound、brake、race cueが4世代で動作する
- [ ] 世代切替時にRaceStateとmusic phaseが維持される
- [ ] DOM HUDが小解像度、keyboard、gamepad、resultで成立する

### QA / Docs

- [ ] 現行baselineを含む全unit/E2Eが合格する
- [ ] 4世代の画像・音声goldenがreview済み
- [ ] context restore、restart 10回、全世代2往復でleakがない
- [ ] 性能budgetを満たす
- [ ] root `npm run verify`と全production buildが合格する
- [ ] `ENGINE_API.md`と`RACING_PROOF.md`が実装結果へ更新されている
