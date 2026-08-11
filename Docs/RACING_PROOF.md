# Racing による再利用性の証明

## 成立している縦切り

`apps/racing` は閉じた1コース、player 1台、deterministic AI 1台、3周で構成する。

- 3秒 countdown → race → 3 lap finish → result → `R` restart
- fixed-step kinematic car、加速、ブレーキ、ステア、後退、路外減速、境界拘束、最後の安全位置へ復帰
- checkpoint順序とコース接線の向きが一致したときだけlap加算
- lap + course progressによる2台の順位
- keyboard/gamepad ActionMap
- DOM HUDによるgeneration/lap/rank/time/countdown/result表示
- 1つの`RaceState`から4世代すべてのcommandを同一`RenderFrame`へgeneration mask付きで構築
- 実行中の全12方向の世代切替でRaceState identity、車両状態、bar positionを保持

## 4世代の完成像

| Generation | Racing presentation | Production Engine path |
| --- | --- | --- |
| FC | 144行の再利用scanline table、ImageGen製8-bit車両/海岸/路面 | raster surface → fixed54 → RF/CRT |
| SFC | course progress/headingから作るaffine UV、16-bit車両/地面/海岸 | affine surface → RGB555 → composite/CRT |
| PS1 | 提供Gen3 GLB由来978 triangle、256px base color | nearest、vertex quantize、affine UV、triangle sort、depthなし |
| PS2 | 提供Gen4 GLB由来13,618 triangle、1024px base color | depth、ambient/directional/point、shadow、equirect reflection |

FC/SFCのspriteはtarget pixelのscreen-space planeで、surfaceより後に描く。PS1/PS2は共通の背後追従cameraを使う。
transition中は旧・新それぞれのscene targetが同じ論理tickから描かれ、palette/CRT後にcomposeされる。

## Runtime asset証跡

- source GLBは`apps/racing/data`から変更しない。
- `prepare-car-models.ts`が必要なgeometry buffer viewだけをdeterministicに再梱包し、base colorを外部化する。
- Gen4のidentity `node.matrix`は暗黙identity TRSへ正規化する。
- `check-car-models.ts`がsource/runtime SHA-256、canonical geometry fingerprint、triangle/bounds、Engine loader、
  texture寸法、file budget、PS2 environmentを検査する。
- 2回連続変換で2 GLB、2 texture、conversion recordがbyte-identicalになった。
- FC/SFC PNGは`check-retro-images.ts`が寸法、RGBA色数、alpha gutter、tile seamをNodeだけで検査する。
- manifestは`public/assets`だけを参照し、`data`をruntime配信しない。

## 音声

- 132 BPM / 4-4 / 8小節 / 128 tickのmaster scoreを4つのcapability-derived arrangementへ変換する。
- sourceはPSG / BRR / ADPCM / streaming。全arrangementのtempo/bar/loop lengthは同一。
- player車両は12 Hz・95 ms短音、AIは6 Hz・距離減衰。既存voice allocator内でoverlapし、continuous APIは追加しない。
- brakeは0.6/0.25と速度8/5のhysteresisを持つ。
- countdown/start/lap/finish cueはactive generation sourceの`playOneShot()`を通る。
- 全12方向切替でbar誤差は`1e-9`以下（実測0）。
- OfflineAudioContextで4世代各2小節を48 kHz renderし、50 ms無音窓0、clip sample 0。

## 使用したEngine公開API

| 領域 | API |
| --- | --- |
| lifecycle | `GameModule`, `GameHost`, fixed update, dispose |
| generation | profiles/capability、controller、transition、generation mask |
| input | `defineActions`, `createActionMap`, keyboard/gamepad `DeviceSnapshot` |
| render | `RenderFrame`, mesh/model/sprite/background/material/light、raster/affine surface |
| assets | `AssetManager`, image/glTF/GPU handle、restore/dispose |
| audio | generation audio service、phase-stable clock、`Score`、`PlayRequest`、voice limit |
| physics | `nearestPointOnSegment`（コース中心線query） |
| platform | browser loop、resize、audio unlock |

## 境界証跡

- `apps/racing`から`apps/console-chaos`へのimportは0件。
- Engine deep importは0件。すべて`@console-chaos/engine`公開入口から参照する。
- `packages/engine/src`へcar/race/track/lapなどRacing固有語彙を追加していない。
- Engine追加機能はgeneric surface/light/environment/screen-space spriteに限定した。
- Console command/state/audio goldenは不変で、407 unit + Console E2Eが合格する。

## 自動・実ブラウザ検査

- Racing unit: car/track/lap/race、RaceVisualState非変更、5 raster golden、affine UV、4世代command、asset/audio contract。
- Racing E2E: public GameHost lifecycle、4世代各3周完了/restart、全12切替、10 restart、2往復、null audio、dispose。
- Engine: surface/environment CPU contract、shader resource lifecycle、10 context restoreでregistry一定。
- Production captures: `phase3-fc.png`、`phase3-sfc.png`、`phase4-ps1.png`、`phase4-ps2.png`。
- PS2 performance: 180 frames、average 16.6737 ms、p95 17.7000 ms、27,685 triangles、4 target、通常1 generation。
- Dispose: 13 active runtime assets → 0、generation listener 1 → 0。
- root `npm run verify`: lint、全unit/E2E、boundary/migration、Console/Racing asset、bundle、全buildが合格。
