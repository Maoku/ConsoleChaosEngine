# @console-chaos/asset-pipeline リリースノート

## 0.1.0 — 2026-08-16

- 8bit RGB/RGBA PNG、画像 geometry、premultiplied-alpha area resample、matte 処理を追加しました。
- fixed palette、RGB555、median cut、区画 palette、組織的 dither、binary alpha を追加しました。
- Engine generation profile から素材 spec を導出する `defineAssetClass` を追加しました。
- deterministic manifest を生成する recipe runner と `console-chaos-assets` build/check CLI を追加しました。
- Console Chaos の4世代 texture generator を最初の consumer として移行し、68出力の RGBA parity を確認しました。
- ConsoleChaosNazotoki の背景・立ち絵 generator を consumer として移行し、24出力の RGBA parity を確認しました。
