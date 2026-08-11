# Console Chaos 忠実性マトリクス

基準は `../Opus5ConsoleChaos` の commit `6281193`。参照元は開始時・実装後とも clean で、
取り込んだ追跡対象531ファイルの size/SHA-256 は `REFERENCE_SNAPSHOT.json` に固定した。

| 項目 | 検査 | 結果 |
|---|---|---|
| baseline import | 複製直後に元の `npm run verify` | pass（596 tests、lint/level/trademark/assets/build） |
| engine profile split | hardware + Console theme と旧 `PROFILES` の deep equal | pass（4/4） |
| core migration | Console の loop/time/events/rng/ECS を engine 公開 entry の再exportへ変更 | pass（601 tests） |
| deterministic replay | 位置、速度、世代、solved set、checkpoint、tick、seed の SHA-256 | pass（10/10） |
| 4世代 profile | resolution/projection/palette/depth/filter/signal/input/audio の旧値 | pass（deep equal） |
| switch | 350 ms、強制600 ms、後勝ち、強制優先、無敵、warning/release | pass（switcher unit） |
| input | keyboard/gamepad、4方向、斜め、analog、pressure、switch | pass（input unit + replay） |
| physics/projection | 2D/3D overlap、3D吸着、安全位置、落下復帰 | pass（physics/projection/checkpoint + replay） |
| puzzles | F-1、F-2、S-1、P1-1、P1-2、P2-1 | pass（全6登録、unit、area1 full replay） |
| render algorithms | sprite limit、palette crush/RGB555、affine UV、sort、shadow、model/sprite/backdrop | pass（unit + golden） |
| assets/levels | glTF subset 12件、texture 68件、level 3件 | pass |
| common scene adapter | 既存 level JSON を変更せず共通 entity/sector へ投影、作品固有 metadata を除外 | pass（reference validation） |
| audio | phase、bar structure、voice limit、4 source、SFX | pass（audio/music tests、誤差1e-9以下） |
| audio baseline | 48kHz OfflineAudioContext 1周、無音窓0、clipなし | 取り込み済み記録 `apps/console-chaos/Docs/measurements/T1-16_music.md` |
| image baseline | CH1〜CH4 と puzzle/transition の既存 capture | 取り込み済み `apps/console-chaos/Docs/measurements/` |
| browser after migration | CH3起動、CH1切替、HUD/WebGL/CRT描画、console logs | pass（error/warning 0） |
| standalone build | Console app が engine package dependencyだけで Vite build | pass |
| root verification | engine 10 + testkit 1 + Console 601 + Racing 10、境界/asset/reference、全 build | pass（622 tests） |

ブラウザ画像の GPU 差を伴うため、この実装では取り込み済み algorithmic golden は完全一致、
実ブラウザは同じ URL (`?scene=mini&level=area1&playtest=0`) で目視確認した。
ゲームデザイン、level JSON、asset binary、puzzle条件には変更を加えていない。
