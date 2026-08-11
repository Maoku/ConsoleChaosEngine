# Console Chaos Engine 公開 API

公開入口は `@console-chaos/engine` の `.` だけである。app からの deep import は
`tools/check-boundaries.ts` と `tools/check-console-migration.ts` が禁止する。

## 最小 GameModule

```ts
import {
  createBrowserLoopHost,
  createGameHost,
  createGenerationCanvasRenderer,
  createKeyboardGamepadSource,
  type GameModule,
} from '@console-chaos/engine';

const game: GameModule = {
  id: 'example',
  async create(context) {
    let x = 0;
    return {
      prepareFixedUpdate() {
        // input sample と generation request はここで行う。
      },
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
  renderer: createGenerationCanvasRenderer(canvas),
  input: createKeyboardGamepadSource(),
});
await host.start(game);
window.addEventListener('pagehide', () => host.dispose(), { once: true });
```

## lifecycle と tick 順序

`GameHost` は loop、input、generation、assets、audio、world、renderer を一つずつ所有する。
固定 tick は次の順序である。

1. `DeviceInputSource.poll()`
2. `GameInstance.prepareFixedUpdate()`
3. `GenerationController.advance()`
4. `AudioService.update()`
5. `GameInstance.fixedUpdate()`
6. render 時に再利用 `RenderFrame` を reset → `buildRenderFrame()` → `FrameRenderer.render()`

`dispose()` は module、input、assets、audio、world、renderer を一度だけ解放する。hidden 復帰時は
catch-up せず、通常 catch-up は最大5 tickである。

## generation

- `GENERATION_IDS`: `FC / SFC / PS1 / PS2`。表示名には使わない。
- `HARDWARE_GENERATION_PROFILES`: video/audio/input 能力の唯一の正本。
- `defineGenerationVariant()`: camera、art、gameplay rule など作品固有 theme の網羅表を作る。
- `GenerationController`: 通常350 ms、強制600 ms、warning/cancel/release、before/switch/after event、
  強制優先queue、切替中無敵を提供する。
- `renderGenerations()`: 通常は1世代、transition 中だけ旧/新2世代を返す。

## input

`defineActions()` と `createActionMap()` は app が定義した button/axis を keyboard/gamepad の
`DeviceSnapshot` から作る。hardware profile に従って deadzone、4方向化、斜め制限、last-axis tie break、
hold、pressure semantics を適用する。focus loss 時は browser input source が全状態を neutral に戻す。

## render / assets

- `RenderFrame`: camera、mesh、skinned mesh、sprite、light、background、material、overlay の平坦な command buffer。
- `createGenerationCanvasRenderer()`: 4世代の target を起動時に確保し、通常1枚、transition 中2枚を合成する。
- `AssetManager`: pending load と参照数を key ごとに共有する。text/binary/image/glTF/GPU resource を扱い、
  最後の `release()` で解放する。`restoreGpuResources()` は context 再構築時に active GPU handle を差し替える。
- 公開 utility: WebGL wrapper、camera、geometry、triangle sort、sprite limit、master palette、glTF subset loader。

## audio

`createGenerationAudioService()` は transport clock と4種類の generation source factory を所有する。
`setGenerationProfile()` は hardware の synth/channel/sample rate/reverb/positional 値だけから source を選ぶ。
app は `Score` と `PlayRequest` を作り、曲名やSFX IDを engine へ持ち込まない。source 切替後も bar position は
共通 clock を正本にする。

## Console と Racing

Console は `createConsoleChaosModule(level)`、Racing は `RACING_GAME_MODULE` を `host.start()` に渡す。
両作品とも `prepareFixedUpdate()` で同じ engine ActionMap と GenerationController を使い、
`buildRenderFrame()` で同じ generic command を作る。Console の puzzle/projection/theme/content と
Racing の car/lap/race rule は各 app 内に留まる。

## testkit と検査

`@console-chaos/engine-testkit` は manual loop、mutable input、recording renderer/audio を提供する。
production browser global を作らず module lifecycle と replay を検査できる。

最終検査は root の `npm run verify`。boundary/migration fixture、resource lifecycle、reference snapshot、
Console bundle source map の legacy exclusion、全 unit/contract/E2E/build を含む。
