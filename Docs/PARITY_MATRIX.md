# Console Chaos 移行忠実性マトリクス

legacy 基準は `../Opus5ConsoleChaos` の commit
`628119358e720514a1f17006654f61e82cc4c207`。追跡対象531ファイルの size/SHA-256 は
`Docs/REFERENCE_SNAPSHOT.json` に固定し、最終確認でも HEAD一致・clean を確認した。

「legacy baseline」「自動化された新runtime結果」「実ブラウザ確認」を混同しない。

| 項目 | legacy baseline | GameHost runtime result | 判定 |
|---|---|---|---|
| production boot | `bootstrap → main.ts` | `bootstrap → engine-bootstrap → GameHost → ConsoleChaosModule` | static + browser pass |
| runtime diagnostic | legacy | `data-console-chaos-runtime="game-host"`, engine `0.1.0` | browser pass |
| generation hardware | 旧flat profile値 | engine hardware + app theme の4/4網羅 | unit pass |
| deterministic replay | 10記録 | position/velocity/generation/solved/checkpoint/tick/seed 一致 | 10/10 pass |
| switching | 350/600 ms、warning、queue、無敵 | engine controller contract | pass |
| input | keyboard/gamepad/4方向/analog/pressure | DeviceSnapshot + ActionMap contract | pass |
| physics/projection | 2D/3D overlap、吸着、安全位置、復帰 | app gameplay + engine ECS/time | pass |
| puzzles | F-1/F-2/S-1/P1-1/P1-2/P2-1 | 全6登録、unit、area1 replay | pass |
| presentation contract | legacy fixed Frame | generic mesh/skinned/sprite/light/background/material commands | host contract pass |
| art/content golden | palette/theme/material/model/backdrop/shadow | hardware/themeを別正本としてasset検査 | pass |
| render capture | 取り込み済み CH1〜CH4/puzzle/transition capture | 2026-08-11にarea1 CH3→CH4とminiを目視確認 | manual pass; pixel比較なし |
| assets | 12 glTF、4 texture sets、3 levels | engine loader + app content checker | pass |
| audio score/SFX | 4編曲、voice limit、4 source | public hardware値からscore/SFX/sourceを選択 | unit pass |
| audio waveform | legacy OfflineAudio記録 | 今回は新しいPCM captureを採取していない | baseline retained |
| lifecycle | legacy page teardown | boot/dispose 10回、GPU restore 10回、active resource 0 | contract pass |
| browser URL/HUD | `scene/level/playtest` query | area1とmini、CH3→CH4、HUD更新、error/warning 0 | browser pass |
| production bundle | legacy runtimeを含む | GameHost source必須、旧7 source禁止、dev global禁止 | pass (3 chunks) |
| Racing regression | legacy対象外 | public engineのみでunit + lifecycle E2E + build | pass |
| immutable reference | 531 files / `6281193` | HEAD一致、clean、snapshot一致 | pass |

## 差分の扱い

- level JSON、asset binary、puzzle条件、replay入力列は変更していない。
- runtime renderer は legacy WebGL monolithではなく generic generation Canvas backend である。
  command/content contract は自動検査済みだが、legacy画像とのpixel-perfect比較は行っていない。
- audioのbar構造、source選択、SFX、voice limitは自動検査済み。新runtimeのPCM再採取は未実施である。
- 上記2件を「exact parity」とは記録しない。legacy baselineの証跡と新runtimeの構造・実画面確認を分けて残す。
