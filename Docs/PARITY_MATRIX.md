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
| presentation contract | legacy fixed Frame | generic mesh/skinned/sprite/light/background/material/wireframe commands | host contract pass |
| art/content golden | palette/theme/material/model/backdrop/shadow | hardware/themeを別正本としてasset検査 | pass |
| render capture | 取り込み済み CH1〜CH4/puzzle/transition capture | 4世代+切替50%+6puzzleの全command SHA-256を固定。production/referenceを同一ブラウザでCH1〜CH4比較 | golden + live pass |
| assets | 12 glTF、4 texture sets、3 levels | engine loader + app content checker | pass |
| audio score/SFX | 4編曲、voice limit、4 source | public hardware値からscore/SFX/sourceを選択 | unit pass |
| audio waveform | legacy OfflineAudio記録 | 48 kHz stereoを4世代×14.4秒再取得。peak/RMS/hash、0.25秒無音窓0を固定 | exact golden pass |
| lifecycle | legacy page teardown | boot/dispose 10回、context event、GPU restore 10回、active resource 0 | contract pass |
| browser URL/HUD | `scene/level/playtest` query | mini/ps1/fc/switch/character/player、1〜4、B/M/C、HUD、error/warning 0 | browser pass |
| production E2E | legacy page | Console本編でpuzzle、1→2→3→4、audio unlock、reset、dispose。Racingも同一root gate | 2/2 pass |
| production bundle | legacy runtimeを含む | GameHost source必須、旧7 source禁止、dev global禁止 | pass (3 chunks / 170,300 bytes) |
| Racing regression | legacy対象外 | public engineのみでunit + lifecycle E2E + build | pass |
| immutable reference | 531 files / `6281193` | HEAD一致、clean、snapshot一致 | pass |

## render / audio 証跡

- level JSON、asset binary、puzzle条件、replay入力列は変更していない。
- runtime renderer は legacy WebGL monolithをengine所有のgeneric WebGL passへ移した。Canvas fallbackは
  production bootstrapでは使わない。`M3_render_command_golden.json` は描画順を含む11 captureを固定する。
- production/referenceのlive比較で検出したImageBitmap背景の上下反転は修正済み。CH1〜CH4のworld、背景、
  player、CRT、HUDが同じ構図になることを再確認した。時間依存animation/noiseを含むためPNG byte hash同一とは記録しない。
- `M4_pcm_golden.json` はFC/SFC/PS1/PS2のpeak、RMS、先頭PCM fingerprintを固定する。
- 意図的なgameplay/content/操作差分は0件。所有場所とgeneric API化だけがarchitecture差分である。
