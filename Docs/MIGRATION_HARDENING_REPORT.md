# M7 Hardening Report

計測日: 2026-08-11 (Asia/Tokyo)

## static / build

- migration checker: legacy finding 0、違反fixture検出 pass。
- boundary checker: package越境fixture検出を含め pass。
- Console production bundle: GameHost source必須、legacy `main/switcher/transition/input/pipeline/renderer/audio` source 0。
- bundle計測: 3 JavaScript chunks、170,300 bytes（source mapを除く）。productionに `__consoleChaos` globalなし。
- engine WebGL wrapper: 実効634 / 1,500行。engine ECS: 実効161 / 400行。

## lifecycle / context restore

- GameHost の boot→2 frame→dispose を10回実行。
- module/input/audio/renderer は各10回だけ dispose。二重disposeは増分なし。
- 各cycle後に world entity 0、AssetManager active resource 0。
- active GPU handleを保った `restoreGpuResources()` を10回実行。registryは active 1 / GPU 1で一定。
- 最終release後に active 0、旧GPU instanceは各回1度だけ解放。
- `webglcontextlost` の既定動作抑止とlost状態、`webglcontextrestored` 通知、unsubscribe、dispose後の
  listener無効化をfake canvasで直接検査した。
- ImageBitmapの上下方向をupload前に焼き込み、context再生成時にも同じ向きでGPU textureを再作成する。

## performance

`npm run bench:sort -w @console-chaos/console-chaos -- --json` の計測結果:

| triangles | radix median | radix p95 | 2.0 ms budget |
|---:|---:|---:|---:|
| 8,000 | 0.077 ms | 0.094 ms | pass |
| 16,000 | 0.153 ms | 0.161 ms | pass |
| 32,000 | 0.332 ms | 0.357 ms | pass |

simulation は60 Hz固定、catch-up最大5 tick、hidden復帰catch-upなしを engine test で固定している。
rendererは4世代分のpostfx targetを起動時確保し、controller contract上は通常1世代、transition中2世代だけを返す。

## production browser

Vite production previewを `?scene=mini&level=area1&playtest=0` で起動し、次を確認した。

- runtime `game-host` / engine `0.1.0` / canvas 960×720。
- 初期 HUD `CH 3 / 第3世代`、`Digit1`〜`Digit4` の全世代で350 ms後に切替表示終了。
- `?scene=mini&level=mini&playtest=0` への再起動後も `CH 3 / 第3世代`、puzzle `0 / 0`。
- `mini/ps1/fc/switch/character/player` の全query URLがGameHost上で起動。
- BGMのB/M、colliderのC、restartのRと各HUDを確認。console error/warning 0。
- productionでは開発用 `__consoleChaos` globalを公開しない。
- pagehide解放はsource gateと10-cycle host contractで検証した。

## render / audio parity

- 4世代、PS1→PS2切替50%、6puzzleの11 `RenderFrame` command captureをSHA-256 golden化。
- production/referenceを同じブラウザ・同じarea1 URLで比較し、背景、world、player、CRT、HUDの一致を確認。
- WebGL移行時に見つかったImageBitmap textureの上下反転を修正し、unit contractを追加。
- OfflineAudioで48 kHz stereoを4世代×14.4秒生成。0.25秒無音窓0、peak 1未満、世代別fingerprint一致。
- mute→曲変更→resumeは停止tickから正しい曲を再開し、generation切替bar位置誤差は1e-9以下。

## reference proof

- reference HEAD: `628119358e720514a1f17006654f61e82cc4c207`。
- reference worktree: clean。
- `Docs/REFERENCE_SNAPSHOT.json`: 531 files、一致。

## parity scope

state replay、hardware/theme値、6puzzle、asset、score/SFX、PCM、render command、host lifecycleは自動比較済み。
live PNGはanimation/noiseの採取時刻が異なるためbyte hashではなく同時side-by-sideで判定し、command列はexact hashで固定した。
詳細は `Docs/PARITY_MATRIX.md` の区分を参照する。
