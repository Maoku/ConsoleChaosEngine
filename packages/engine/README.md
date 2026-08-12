# @console-chaos/engine

Console Chaos Engineの公開npmパッケージです。固定ティックのゲームホスト、決定論的なECS/RNG、
4世代のハードウェア表現、入力、音声、アセット管理、Canvas 2D/WebGLレンダラーを提供します。

## 必要環境

- ESMを扱えるTypeScriptまたはJavaScriptプロジェクト
- ES2022対応のビルドターゲット
- 描画・入力・音声を使う場合はブラウザ環境
- WebGLレンダラーを使う場合はWebGL 2

パッケージ自体はESMです。CommonJS向けビルドは含みません。

## インストール

同じマシンで生成したtarballを使う場合:

```sh
npm install /path/to/ConsoleChaosEngine/artifacts/console-chaos-engine-0.1.0.tgz
```

レジストリへ公開済みの場合:

```sh
npm install @console-chaos/engine
```

## 最小構成

HTMLに `<canvas id="game"></canvas>` を用意し、次のようにホストを開始します。

```ts
import {
  createBrowserLoopHost,
  createCanvasCommandRenderer,
  createGameHost,
  createKeyboardGamepadSource,
  observeCanvasResize,
  type GameModule,
} from "@console-chaos/engine";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("Missing #game canvas");

const renderer = createCanvasCommandRenderer(canvas);
const resize = observeCanvasResize(canvas, renderer.resize);

const game: GameModule = {
  id: "minimal-game",
  async create() {
    let time = 0;
    return {
      fixedUpdate({ dtSeconds }) {
        time += dtSeconds;
      },
      buildRenderFrame(frame) {
        frame.backgrounds.push({ color: "#101828", secondaryColor: "#284060" });
        frame.meshes.push({
          id: "player",
          geometry: { kind: "box", halfExtents: [0.5, 0.5, 0.5] },
          transform: { position: [Math.sin(time) * 2, 0, 0] },
          color: "#f8d66d",
        });
      },
      dispose() {},
    };
  },
};

const host = createGameHost({
  loopHost: createBrowserLoopHost(),
  renderer,
  input: createKeyboardGamepadSource(),
  initialGeneration: "PS1",
});

await host.start(game);

window.addEventListener(
  "pagehide",
  () => {
    resize.dispose();
    host.dispose();
  },
  { once: true },
);
```

テクスチャ、glTF、世代別ポストエフェクトを使う場合は `createGenerationWebGlRenderer` を選択します。
このレンダラーには `AssetManager` と `RenderAssetManifest` が必要です。実運用例は
`apps/racing/src/bootstrap.ts` にあります。

## 4世代のコンソール表現

### 表現モデル

4世代は、特定実機を命令・タイミング単位で再現するエミュレーターではありません。ゲーム内容を共通に
保ちながら、世代ごとの制約を映像、音声、入力へ一貫して適用するための表現プロファイルです。

- ゲームロジックとECSの状態は世代を切り替えても維持される
- `RenderFrame` には複数世代のcommandを `generations` mask付きで同居させられる
- rendererは世代IDの直接分岐ではなく、`HardwareGenerationProfile` の能力値を参照する
- 通常は現在の1世代だけを描画し、transition中だけ旧・新の2世代を別々に描画して合成する
- 音楽のtransport位置を維持したまま、voice sourceと同時発音数を世代に合わせて切り替える

したがって「世代を変える」はゲームをロードし直す操作ではなく、同じ瞬間を別のハードウェア制約で
再解釈する操作です。

### 映像プロファイル比較

| 項目             | 第1世代 `FC`       | 第2世代 `SFC`     | 第3世代 `PS1`                   | 第4世代 `PS2`                         |
| ---------------- | ------------------ | ----------------- | ------------------------------- | ------------------------------------- |
| 内部解像度       | 256×224            | 256×224           | 320×240                         | 640×448                               |
| projection       | orthographic 2D    | orthographic 2D   | perspective 3D                  | perspective 3D                        |
| 信号             | RF                 | composite         | S-Video                         | component                             |
| palette          | 固定54色・同時25色 | RGB555・同時256色 | profile上の色数制限なし         | profile上の色数制限なし               |
| palette block    | 16px               | 8px               | なし                            | なし                                  |
| sprite/scanline  | 8                  | 32                | 制限なし                        | 制限なし                              |
| 座標snap         | 8px tile           | 1px               | なし                            | なし                                  |
| translucency     | なし               | RGB555 color math | 4固定係数 mode・OT slot 12      | GS alpha preset                       |
| sprite composition | separate plane  | separate plane    | scene（world/screenをOTへ統合） | scene（depth対応）                    |
| 特殊描画         | raster scroll      | affine plane      | affine texture・vertex quantize | depth・dynamic light・environment map |
| depth buffer     | なし               | なし              | なし                            | あり                                  |
| texture filter   | nearest            | nearest           | nearest                         | linear                                |
| animation sample | 6 Hz               | 12 Hz             | 30 Hz                           | 60 Hz                                 |

`maxSimultaneousColors` や `spritesPerScanline` の「制限なし」は、エンジンの世代プロファイルが追加制限を
課さないという意味です。GPUやブラウザ自体の上限がなくなるわけではありません。

`createGenerationWebGlRenderer()` が内部解像度、palette/RGB555、CRT、surface pass、depth、
texture補間、頂点量子化、lighting、animation sample rateを自動適用します。一方、
`maxSimultaneousColors`、`paletteBlockSize`、`spritesPerScanline`、`tileSnap`、`translucency` はasset制作、
gameplay、検証ツールでも参照する能力契約です。例えば走査線sprite制限は `applyScanlineLimit()` を使い、
その結果を描画と当たり判定へ反映します。`createCanvasCommandRenderer()` は軽量fallbackであり、これらの
世代表現を完全には再現しません。

### 第1世代: `FC`

最も強い2D制約を持つ世代です。sceneは256×224で描画され、master paletteから固定54色へ量子化されます。
1つの場面で使える色は25色、paletteの選択単位は16pxです。spriteは1走査線あたり8個に制限でき、
座標は8px tileへ揃える想定です。半透明合成は使いません。

疑似3Dや曲面道路は `RasterSurfaceCommand` のscanline tableで表現します。各走査線のsource位置、幅、
明るさを変え、`rasterScroll` passで水平スクロールや遠近を作ります。textureはnearest filter、skinned
animationは6 Hzに量子化されるため、輪郭の明確なpixel artと少ないanimation frameが適します。

映像信号はRFです。full CRT品質ではscanline 0.32、色にじみ 0.85、curvature 1.0、noise 0.055を
基準とし、4世代で最も強いにじみ、歪み、ざらつきを加えます。

音声は5 voiceのPSGで、PCM sample rateを持たない波形合成です。reverbとpositioningはありません。
入力は4方向D-padで、斜め、analog、pressure、rumbleを無効にします。

### 第2世代: `SFC`

同じ256×224の2Dを基礎にしつつ、色と疑似3Dの能力を広げた世代です。色はRGB555へ量子化され、
同時256色、8px palette block、1走査線32 spriteを利用できます。半透明は汎用alphaではなく、RGB555へ
量子化したmain/sub screenの加算・減算・half結果というcolor mathです。入力は8方向D-padになり、
斜め移動も許可されます。

地面、道路、床は `AffineSurfaceCommand` のUV originとX/Y stepで1枚のtextureを変形する
`affinePlane` passが中心です。これは3D meshではなくscreen-spaceの疑似3Dなので、spriteと組み合わせる
ことで軽量な奥行き表現を作れます。textureはnearest、animationは12 Hzです。

映像信号はcompositeです。full CRT品質ではscanline 0.28、色にじみ 0.55、curvature 0.85、
noise 0.025となり、RFより鮮明ですが色境界には意図的なにじみが残ります。

音声は32 kHzのBRR sample、最大8 voice、reverbあり、positioningなしです。analog、pressure、rumbleは
まだ使用しません。

### 第3世代: `PS1`

320×240のperspective 3Dへ移る世代です。低polygonのmesh、低解像度texture、nearest filterを基本に、
頂点をprofile値2でscreen-space量子化して輪郭の揺れを作ります。perspective-correct補間を弱める
`affineTexture` により、視点移動時にtextureが歪む表現を加えます。

depth bufferは使わず、rendererは固定12 slotのordering tableを0→11の順に走査します。既定ではopaque worldを
slot 1..8、半透明を9、screen-space spriteを10、debugを11へ登録し、同じslot内の登録順を安定保持します。
`orderTableIndex` で固定slot、`polygonSortRange` でtriangle単位の安定O(n+12) view-space分割範囲を指定できます。
world/screen spriteも同じtableへ入るため、meshとの順序を明示できます。dynamic point lightとenvironment mapは
無効なため、material色、texture、ambient/directional成分を中心に画面を設計します。animationは30 Hzです。

映像信号はS-Videoです。full CRT品質ではscanline 0.22、色にじみ 0.25、curvature 0.6、noise 0.012で、
輝度と色の分離により前2世代より輪郭が明確になります。

音声は44.1 kHzのADPCM、最大24 voice、reverbとpositioningありです。入力は2 analog軸とrumbleを
利用でき、斜め入力も許可されます。pressure-sensitive buttonはまだ無効です。

### 第4世代: `PS2`

640×448のperspective 3Dで、4世代の中で最も連続的で高密度な表現です。depth bufferを有効化し、
ambient・directional・point light、projected shadow、environment mapによる反射を利用できます。
world spriteはspherical/cylindrical billboardとdepth writeを選択でき、screen-space spriteはscene末尾へ
合成されます。textureはlinear filter、animationは60 Hzです。頂点量子化とaffine textureは適用しません。

映像信号はcomponentです。full CRT品質でもscanline 0.14、色にじみ 0.08、curvature 0.35、noise 0.004に
抑え、軽い走査線と周辺減光だけを残した鮮明な画面にします。

音声は48 kHzのstreaming source、最大48 voice、reverbとpositioningありです。入力は4 analog軸、
pressure-sensitive button、rumbleを利用できます。

### 世代切替とtransition

`createGenerationController()` は `FC → SFC → PS1 → PS2` の順序と現在のprofileを管理します。
通常切替は350 ms、強制切替は600 msで、強制切替には既定1,500 msの事前警告を設定できます。
transition中の `renderGenerations()` は旧世代と新世代を返し、rendererは各世代固有の解像度、palette、
surface、lighting、CRTを適用した後でblendします。

```ts
import {
  HARDWARE_GENERATION_PROFILES,
  createGenerationController,
  defineGenerationVariant,
} from "@console-chaos/engine";

const generation = createGenerationController("FC");
generation.request("SFC");

const playerColor = defineGenerationVariant({
  FC: "#f8d66d",
  SFC: "#ffd080",
  PS1: "#d8b070",
  PS2: "#fff0c0",
});

console.log(HARDWARE_GENERATION_PROFILES[generation.generation]);
console.log(playerColor[generation.generation]);
```

ゲーム固有の世代差は `defineGenerationVariant()` にまとめ、rendererの能力差はprofileへ任せるのが基本です。
世代固有のcommandだけを描く場合は、`MeshCommand`、`SpriteCommand`、`MaterialCommand` などの
`generations` に対象世代を指定します。

## 公開APIの構成

- `createGameHost`: 固定ティック更新と補間描画を統合するランタイム
- `createWorld` / `defineComponent` / `query*`: ECS
- `createRng` / `hash32` / `pick`: 決定論的乱数
- `createGenerationController`: FC・SFC・PS1・PS2世代の切替
- `defineActions` / `createActionMap`: キーボード・ゲームパッド入力の抽象化
- `createRenderFrame`: レンダーバックエンド非依存の描画コマンド
- `createCanvasCommandRenderer`: 軽量なCanvas 2Dレンダラー
- `createGenerationWebGlRenderer`: 世代別表現を含むWebGL 2レンダラー
- `createGenerationAudioService`: 世代別の音声制約とスコア再生
- `createAssetManager` / `loadGltf`: 参照カウント付きアセット管理とglTF読込

すべての安定公開APIはパッケージルートからimportします。`dist/` 以下への直接importはサポート対象外です。

## テスト

DOMや実時間に依存しないテストには、同じバージョン系列のテストキットを追加します。

```sh
npm install -D @console-chaos/engine-testkit
```

```ts
import { createGameHost } from "@console-chaos/engine";
import {
  createManualLoopHost,
  createRecordingRenderer,
} from "@console-chaos/engine-testkit";

const loopHost = createManualLoopHost();
const renderer = createRecordingRenderer();
const host = createGameHost({ loopHost, renderer });

// await host.initialize(gameModule);
// host.start();
// loopHost.setNow(16.67);
// loopHost.runFrame();
```

配布物の作成、検証、レジストリ公開手順はリポジトリの `Docs/DISTRIBUTION.md` を参照してください。
