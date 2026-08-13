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

- `RenderFrame`: camera、mesh、skinned mesh、sprite、light、background、material、overlay、
  `rasterSurfaces`、`affineSurfaces` の平坦な command buffer。surface は内部解像度の左上原点pixel rectを使い、
  FCの走査線tableとSFCのUV affine transformをappから受け取る。Engineはゲーム固有の意味を解釈しない。
- `SpriteCommand.screenSpace`: 省略時は従来どおりworld plane。`true`では`position.x/y`と`size`を
  generation target pixelとして描く。raster/affine surface上のHUDではないgame spriteに使用できる。
- `SpriteCommand.billboard/depthWrite`: scene spriteのworld向きを`cylindrical / spherical / none`から選び、
  depth buffer世代でdepth書込みを制御する。FC/SFCは`profile.video.spriteComposition === 'separate-plane'`のため
  従来のsprite FBOへ、PS1/PS2は`scene`のためmeshと同じscene passへ入る。
- `HardwareBlendCommand`: `hardwareBlend`をmaterialまたはspriteへ指定する。familyはSFCの
  `gen2-color-math`、PS1の`gen3-semitransparency`、PS2の`gen4-gs`、世代非依存fallbackの`portable`。
  `generations` maskと世代固有familyが矛盾したcommandはfail-fastする。旧`blendMode`は互換入力として残るが、
  新規commandでは`hardwareBlend`を使う。
- PS1 ordering table: `orderTableIndex`は0..11の固定slot、`polygonSortRange`はtriangle分割先の昇順範囲。
  既定slotはopaque world 1..8、半透明9、screen-space sprite 10、debug 11。同一slotではcommand/triangleの
  登録順を保持し、rendererは毎frameの`Array.sort()`や作業配列allocationを行わない。
- `LightCommand`: ambient/directional/pointをgeneration mask付きで指定する。directionalは`direction`を使う。
  commandがない場合は従来の固定lightへfallbackする。
- `MaterialCommand.environmentTexture/environmentStrength`: equirectangular 2D reflectionを指定する。
  `profile.video.environmentMap`がfalseならrendererがstrengthを0にする。
- `createGenerationWebGlRenderer()`: production renderer。4世代のFBO/postfx targetを起動時に確保し、
  通常1世代、transition 中だけ旧/新2世代を描画・合成する。FC/SFCは
  background → screen surface → mesh → separate sprite plane、PS1はbackground → OT12 scene、PS2は
  background → depth scene → late screen spriteとして描き、最後にpalette/CRT → transition composeする。
  ゲーム固有の語彙は持たない。
- `createGenerationCanvasRenderer()`: testkitや軽量fallback向けのgeneric command renderer。
- `AssetManager`: pending load と参照数を key ごとに共有する。text/binary/image/glTF/GPU resource を扱い、
  最後の `release()` で解放する。`restoreGpuResources()` は context 再構築時に active GPU handle を差し替える。
- `orientImageBitmap()`: `UNPACK_FLIP_Y_WEBGL` が効かない `ImageBitmap` の上下方向をupload前に確定する。
- 公開 utility: WebGL wrapper、camera、geometry、triangle sort、sprite limit、master palette、glTF subset loader。

## audio

`createGenerationAudioService()` は transport clock と4種類の generation source factory を所有する。
`setGenerationProfile()` は hardware の synth/channel/sample rate/reverb/positional 値だけから source を選ぶ。
app は `Score` と `PlayRequest` を作り、曲名やSFX IDを engine へ持ち込まない。source 切替後も bar position は
共通 clock を正本にする。mute中の曲変更と再開tickもtransport上で保持する。

## Console Chaos との接続

Console Chaos は `createConsoleChaosModule(level)` を `host.start()` に渡す。
`prepareFixedUpdate()` で engine ActionMap と GenerationController を使い、`buildRenderFrame()` で
generic command を作る。puzzle/projection/theme/content は app 内に留まる。

## testkit と検査

`@console-chaos/engine-testkit` は manual loop、mutable input、recording renderer/audio を提供する。
recording rendererはsurface数も記録し、recording audioはcompact toneに加えて完全な`PlayRequest`も保持する。
production browser global を作らず module lifecycle と replay を検査できる。

最終検査は root の `npm run verify`。boundary/migration fixture、resource/context-loss lifecycle、reference snapshot、
Console bundle source map の legacy exclusion、Console host E2E、render/PCM golden、全buildを含む。
