# Console Chaos Engine 公開 API

公開入口は `@console-chaos/engine` の `.` だけである。`package.json#exports` は deep import を公開せず、
`tools/check-boundaries.ts` が app から `@console-chaos/engine/*` を参照する違反を検出する。

## 最小 GameModule

```ts
import {
  createBrowserLoopHost,
  createCanvasCommandRenderer,
  createGameHost,
  createKeyboardGamepadSource,
  type GameModule,
} from '@console-chaos/engine';

const game: GameModule = {
  id: 'example',
  async create(context) {
    let x = 0;
    return {
      fixedUpdate({ dtSeconds }) {
        x += dtSeconds;
      },
      buildRenderFrame(frame) {
        frame.backgrounds.push({ color: '#17243b' });
        frame.sprites.push({ id: 'player', position: [x, 0, 0], size: [1, 1], color: '#ffd43b' });
      },
      dispose() {},
    };
  },
};

const canvas = document.querySelector('canvas')!;
const host = createGameHost({
  loopHost: createBrowserLoopHost(),
  renderer: createCanvasCommandRenderer(canvas),
  input: createKeyboardGamepadSource(),
});
await host.start(game);
```

## lifecycle

- `GameModule.create(context)`: app 固有リソースと状態を作る。
- `fixedUpdate`: 60 Hz 固定。実時間ではなく `tick/dtSeconds/dtMs` を受け取る。
- `buildRenderFrame`: 再利用される平坦な command buffer を構築する。
- `dispose`: app 固有状態を解放する。続いて host が input/assets/audio/world/renderer を解放する。
- hidden 復帰時は経過分を catch-up しない。通常の catch-up は最大5 tick。

## 世代

`GENERATION_IDS` は既存互換の `FC/SFC/PS1/PS2`。表示名として使わない。
`HARDWARE_GENERATION_PROFILES` が解像度、projection、palette、depth、signal、audio、入力能力を持つ。
ゲーム固有のカメラ、色、モデル、アクション差は `defineGenerationVariant()` で app に置く。

`GenerationController` は通常350 ms、強制600 ms、切替中無敵、後勝ち1件キューを提供する。
切替中だけ `renderGenerations()` が旧/新の2世代を返す。

## 入力

`defineActions()` の action 名は app が決める。engine が知るのは `button/axis1d/axis2d` の値種別だけである。
`createActionMap()` は keyboard/gamepad binding を `DeviceSnapshot` へ正規化し、現在の hardware profile に従って
4方向化、デジタル化、斜め、アナログ、感圧を適用する。

## 描画・assets・audio・physics

- `RenderFrame`: camera、mesh、sprite、light、background、overlay の平坦な配列。
- `FrameRenderer`: app 非依存の描画 backend。標準実装は `createCanvasCommandRenderer()`。
- render utilities: WebGL2 wrapper、camera、geometry、triangle sort、sprite limit、master palette。
- `AssetManager`: URL/key ごとに load 中 Promise と参照数を共有し、最後の release で dispose。glTF subset loader も公開入口から利用できる。
- `MusicClock`: audio time を正本にし、世代の音源差し替えから独立した bar position を返す。
- physics: `Aabb`、overlap、sweep、線分最近点。2DでZを潰す規則は含めない。

## scene

`SceneData` が所有するのは `Transform`、renderable/collider 参照、sector の可視関係、entity id/tags だけである。
ゲーム固有メタデータは app 側の schema に残し、必要な共通部分だけを adapter で投影する。
`validateSceneReferences()` は entity/sector の重複と参照整合性だけを検査する。

## テスト

`@console-chaos/engine-testkit` は manual loop、mutable input、recording renderer/audio を提供する。
browser global を作らず `GameModule` の lifecycle と replay を検査できる。

root の `npm run verify` は engine 10、testkit 1、Console Chaos 601、Racing 10 の計622 tests に加え、
境界、level、asset、商標、参照 snapshot、全 production build を実行する。
