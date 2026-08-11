# Console Chaos 完全移行 最終報告

計測日: 2026-08-11 (Asia/Tokyo)

## 1. 削除したlegacy file / compatibility API

最終差分で削除されたlegacy実装は次のグループである。作品固有の曲、SFX、theme、puzzle、level、assetは残した。

- `apps/console-chaos/src/main.ts`
- `apps/console-chaos/src/generation/{profiles,switcher,transition}.ts`
- `apps/console-chaos/src/input/{mapper,constraints,source_keyboard,source_gamepad}.ts`
- `apps/console-chaos/src/audio/{adpcm_ps1,clock,director,engine,sampler_sfc,score,stream_ps2,synth_fc,voicelimit}.ts`
- `apps/console-chaos/src/core/**`
- `apps/console-chaos/src/render/{camera,frame,geometry,pipeline,renderer2d,renderer3d,sort,sprite_limit}.ts`
- `apps/console-chaos/src/render/{gl,loader,quantize,shaders}/**`
- 旧smoke/debug host、旧scene assembler、旧adapter/pipeline/GL wrapper test。

削除したcompatibility APIは `RawInput`、`createMapper`、`applyConstraints`、app所有generation controller/profile、
legacy固定`Frame`、app所有pipeline/renderer/postfx/quantizer、app所有AudioEngine/source/clock、core re-export shimである。
`tools/check-console-migration.ts --strict` が再導入をfixture込みで拒否する。

## 2. engine public contract

- `GameHost` / async `GameModule` / two-phase fixed tick / single generation controller。
- `defineActions` / `ActionMap` / keyboard+gamepad `DeviceInputSource`。短時間keydown edgeは次pollまで保持する。
- generic `RenderFrame` v2: camera、mesh、skinned mesh、sprite、light、background、material、overlay、wireframe。
- `createGenerationWebGlRenderer`: WebGL command pass、4世代FBO、palette/RGB555/CRT、transition compose。
- `AssetManager`: image/glTF/GPU ref-count、dedupe、restore、dispose。`orientImageBitmap` でtexture方向を固定。
- `createGenerationAudioService`: 4 source、voice limit、score/one-shot、transport、mute/resume tick。
- testkit: manual loop、mutable device snapshot、recording renderer/audio。

engine public sourceはConsoleの曲名、SFX ID、puzzle、level、asset pathをimportしない。appのdeep importもboundary gateで0件。

## 3. 2作品が使用するservice

| service | Console Chaos | Racing |
|---|---:|---:|
| GameHost / fixed loop / ECS world / RNG / events | yes | yes |
| GenerationController / hardware profile | yes | yes |
| DeviceSnapshot / ActionMap | yes | yes |
| generic RenderFrame / renderer contract | yes | yes |
| AssetManager lifecycle | yes | yes |
| AudioService transport/profile lifecycle | yes | yes |

Consoleのprojection/puzzle/theme/contentとRacingのcar/lap/race ruleはそれぞれのappに留まる。

## 4. fidelity golden

- state replay: 10/10。position、velocity、generation、solved、checkpoint、tick、seedのSHA-256一致。
- puzzle: F-1 / F-2 / S-1 / P1-1 / P1-2 / P2-1の全6登録、solvable generation、通しreplay一致。
- render: CH1〜CH4、PS1→PS2 50%、6puzzleの11 command captureを
  `M3_render_command_golden.json` に固定。draw順を含む全command hash一致。
- live render: production/referenceを同一ブラウザ・同一area1 URLで比較。移行中に検出した
  ImageBitmap背景反転を修正後、world、背景、player、CRT、HUDが一致。時間依存noise/animationだけは採取時刻差を許容する。
- audio: 48 kHz stereo、4世代×14.4秒。peak/RMS/fingerprint一致、0.25秒無音窓0、peak 1未満。
  PCM hashは `M4_pcm_golden.json` に固定。
- generation switchのbar position誤差1e-9以下。mute中の曲変更は停止tickから選択曲を再開する。

## 5. production E2E / bundle

- Console本編moduleでboot、F-1成立、1→2→3→4完了、audio unlock、restart、二重disposeを実行。
- Racingも同じroot `test:e2e` でpublic engine APIだけを使用して合格。
- browserで `mini/ps1/fc/switch/character/player`、B/M/C/R、HUDを確認。error/warning 0。
- bundle gate: 3 chunks / 170,300 bytes。GameHost source必須、legacy source 0、production `__consoleChaos` 0。

## 6. performance / resource

- simulation: 60 Hz、catch-up最大5、hidden復帰catch-up 0。
- triangle sort: 8k median 0.077 ms / p95 0.094 ms、16k 0.153 / 0.161 ms、32k 0.332 / 0.357 ms。
- renderer: 通常1世代、transition中2世代。4世代postfx targetは起動時確保、switch時shader compile 0。
- lifecycle: boot→dispose 10回でmodule/input/audio/renderer各10 dispose、world entity 0、active asset 0。
- context restore: active GPU resourceを10回再生成してactive 1 / GPU 1を維持し、最後のreleaseで0。
  context lost/restored listenerとdispose後無効化も直接検査。

## 7. 意図的差分

gameplay、content、asset、level、入力、操作、HUD、音楽構造に意図的差分はない。
差分は所有境界だけで、legacy app monolithをgeneric engine serviceへ移した。live PNGは時間依存演出のため
byte-for-byte approvalには使わず、exact command/PCM/state goldenとside-by-side browser比較を組み合わせた。

## 8. immutable reference

- repository: `../Opus5ConsoleChaos`
- HEAD: `628119358e720514a1f17006654f61e82cc4c207`
- worktree: clean
- snapshot: 531 tracked files、size/SHA-256一致
- root `npm run verify`: legacy runtimeなしで合格
