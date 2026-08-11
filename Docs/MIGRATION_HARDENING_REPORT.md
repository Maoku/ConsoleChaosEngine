# M7 Hardening Report

計測日: 2026-08-11 (Asia/Tokyo)

## static / build

- migration checker: legacy finding 0、違反fixture検出 pass。
- boundary checker: package越境fixture検出を含め pass。
- Console production bundle: GameHost source必須、legacy `main/switcher/transition/input/pipeline/renderer/audio` source 0。
- bundle計測: 3 JavaScript chunks、約93 KB（source mapを除く）。productionに `__consoleChaos` globalなし。
- engine WebGL wrapper: 実効634 / 1,500行。engine ECS: 実効161 / 400行。

## lifecycle / context restore

- GameHost の boot→2 frame→dispose を10回実行。
- module/input/audio/renderer は各10回だけ dispose。二重disposeは増分なし。
- 各cycle後に world entity 0、AssetManager active resource 0。
- active GPU handleを保った `restoreGpuResources()` を10回実行。registryは active 1 / GPU 1で一定。
- 最終release後に active 0、旧GPU instanceは各回1度だけ解放。

## performance

`npm run bench:sort -w @console-chaos/console-chaos -- --json` の計測結果:

| triangles | radix median | radix p95 | 2.0 ms budget |
|---:|---:|---:|---:|
| 8,000 | 0.077 ms | 0.094 ms | pass |
| 16,000 | 0.153 ms | 0.161 ms | pass |
| 32,000 | 0.332 ms | 0.357 ms | pass |

simulation は60 Hz固定、catch-up最大5 tick、hidden復帰catch-upなしを engine test で固定している。
rendererは4 targetを起動時確保し、controller contract上は通常1世代、transition中2世代だけを返す。

## production browser

Vite production previewを `?scene=mini&level=area1&playtest=0` で起動し、次を確認した。

- runtime `game-host` / engine `0.1.0` / canvas 960×720。
- 初期 HUD `CH 3 / 第3世代`、`Digit4` 後に `CH 4 / 第4世代`、350 ms後に切替表示終了。
- `?scene=mini&level=mini&playtest=0` への再起動後も `CH 3 / 第3世代`、puzzle `0 / 0`。
- area1/mini とも console error/warning 0。
- productionでは開発用 `__consoleChaos` globalを公開しない。
- pagehide解放はsource gateと10-cycle host contractで検証した。

## reference proof

- reference HEAD: `628119358e720514a1f17006654f61e82cc4c207`。
- reference worktree: clean。
- `Docs/REFERENCE_SNAPSHOT.json`: 531 files、一致。

## parity scope

state replay、hardware/theme値、puzzle、asset、score/SFX、host lifecycleは自動比較済み。
legacy画像とのpixel-perfect capture比較と新runtime PCM再採取は、このhardening runでは実施していない。
詳細は `Docs/PARITY_MATRIX.md` の区分を参照する。
