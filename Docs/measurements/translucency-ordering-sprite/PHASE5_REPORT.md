# Phase 5 アプリ移行・QA 記録

計測日: 2026-08-12（Asia/Tokyo）

## 実装結果

- Console Chaos の半透明材質を旧 `blendMode` から世代別 `HardwareBlendCommand` へ移行した。
  - FC: 半透明なし
  - SFC: Gen2 color math / add / half / subscreen
  - PS1: Gen3 semi-transparency / average
  - PS2: Gen4 GS / source-over
- `?scene=blend` に不透明背景、半透明板、world-space sprite、screen-space spriteを持つ最小統合場面を追加した。
  PS1はOT slot 2/9/10/11、PS2はspherical billboardとdepth writeを実際のcommandで使用する。
- RacingのPS1 checkpointを固定OT slot 1へ、車体triangleを`polygonSortRange: [2, 7]`へ移行した。
- 公開READMEとAPI文書へ世代別半透明、OT12 slot、sprite routing/billboard/depth writeを追記した。
- command goldenは件数を維持したまま、新しい明示的hardware blend契約を含むhashへ更新した。

ゲームデザイン、当たり判定、既存の可視条件は変更していない。

## OT12 性能

環境: macOS 26.5.2 (25F84), arm64, Node.js v26.0.0

入力はnaive comparator sort、radix sort、OT12 stable partitionで共通とし、warmup 20回、計測60回とした。

| 20,000 triangles | median | p95 | 2.0 ms budget |
|---|---:|---:|---:|
| naive | 5.206 ms | 7.408 ms | fail |
| radix | 0.229 ms | 0.622 ms | pass |
| OT12 stable partition | 0.187 ms | 0.598 ms | pass |

OT12は20,000 trianglesでradixのp95を0.024 ms下回り、計画の「p95 2.0 ms以内」「radixより悪化しない」を
ともに満たした。中央値による2.0 ms推定は212,360 triangles、安全率0.7適用後は148,652 triangles。
全点は [phase5-sort.json](phase5-sort.json) に記録した。

## 回帰・統合QA

rootの`npm run verify`を実行し、終了コード0を確認した。

- Engine unit: 11 files / 46 tests
- Engine testkit: 1 file / 1 test
- Console Chaos unit/golden/replay: 44 files / 413 tests
- Racing unit: 8 files / 25 tests
- Console/Racing E2E: 3 files / 6 tests
- boundary、strict migration、line budget、level、texture/glTF、Racing image/model、trademark、reference snapshot: pass
- Engine、testkit、Console、Racing production build: pass
- Console bundle legacy exclusion: pass

CPU参照式はGen2 add/subtract/half/fixed、Gen3 4 mode、Gen4 presetを既知値で検証し、fake GLでは
equation/factor/constant colorとstate復元を検証した。OT12はslot順、安定順、indexの欠落/重複なし、workspace再利用を、
spriteはcylindrical/spherical/none billboardとPS1/PS2 routeを単体・統合テストで確認した。

実ブラウザのWebGL 2でも4世代の統合場面を切り替え、world/screen spriteと半透明板を目視確認した。
最終タブのconsole warning/errorは0件だった。

## 代表画像

すべて1280×720 JPEG。

- [FC / no translucency](phase5-fc-blend.jpg) — SHA-256 `7428c4f79dc2d7781082aedc1e5a3747e20fa4fa48edbf1771eef062db9291dd`
- [SFC / Gen2 color math](phase5-sfc-blend.jpg) — SHA-256 `b02f6af7b78fc23f23c9366a196c56059774d3dc4a3f0966dd5565143e29983c`
- [PS1 / Gen3 average + OT12](phase5-ps1-blend.jpg) — SHA-256 `e9e0dfa55976fa1a75eda67bd94c7f17527253b92ad5ebade6fbfef057a87f0d`
- [PS2 / GS source-over + depth sprite](phase5-ps2-blend.jpg) — SHA-256 `27b3f664c9f0b9c767410db23cf783319c980d7a6097e6aecc2479afcc34d03a`

## フェーズコミット

1. `652e5c5` Phase 0: 描画基準とソート計測を固定
2. `7ac625d` Phase 1: 世代別半透明とOTの公開契約を追加
3. `e4090d4` Phase 2: PS1描画をOT12安定partitionへ移行
4. `19bc68a` Phase 3: 世代別ハードウェア半透明を実装
5. `14d7b0f` Phase 4: PS1・PS2擬似スプライトをscene描画へ統合
6. Phase 5: アプリ移行・API文書・性能/回帰QA（本記録を含む）
