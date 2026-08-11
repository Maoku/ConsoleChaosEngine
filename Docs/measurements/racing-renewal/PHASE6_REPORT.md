# Racing Renewal Phase 6 Report

Date: 2026-08-11

## Integration result

All renewal phases are integrated through the production Engine path.

- Four generation presentations are present in one frame and selected by generic generation masks/capabilities.
- A scripted centerline completion proof drives the full countdown/checkpoint/lap/finish/restart state machine for FC, SFC, PS1, and PS2.
- Twelve fresh-host directed switches preserve the same `RaceState`, player car fields, and audio bar position.
- Ten restart cycles and two complete generation round-trips leave the host operational.
- Keyboard and gamepad action bindings, null-audio fallback, manifest fallback textures, and DOM HUD are covered.
- Engine AssetManager already executes ten repeated GPU restores while keeping active/gpu registry counts at one, then releases to zero.
- Dispose proof leaves active runtime assets and generation listeners at zero.

## Production performance proof

`apps/racing/tools/performance-proof.html` starts the actual PS2 renderer, preloads all four-generation assets, runs the Racing module for 180 browser frames, reads renderer stats, then disposes the host.

| Metric | Result | Gate |
| --- | ---: | ---: |
| Average frame interval | 16.6737 ms | < 20 ms |
| P95 frame interval | 17.7000 ms | < 34 ms |
| PS2 last-frame triangles | 27,685 | < 60,000 |
| Allocated generation targets | 4 | = 4 |
| Normally rendered generations | 1 | = 1 |
| Active assets before/after dispose | 13 / 0 | after = 0 |
| Generation listeners before/after | 1 / 0 | after = 0 |

The proof reported `PASS`; `phase6-performance.json` records the values and `phase6-performance.png` records the visible result.

## Final visual/audio evidence

- `phase3-fc.png`: FC raster road, fixed palette, RF/CRT, player/AI sprite priority.
- `phase3-sfc.png`: SFC affine ground, RGB555/composite/CRT, player/AI sprite priority.
- `phase4-ps1.png`: converted 978-triangle car, nearest/quantize/affine/sort path.
- `phase4-ps2.png`: converted 13,618-triangle car, depth/light/shadow/environment path.
- `phase5-offline-audio.json` / `.png`: four sources × two bars, silent windows 0, clipped samples 0.

## Final verification inventory

- Engine: 8 files / 29 tests.
- Engine testkit: 1 file / 1 test.
- Console: 42 files / 407 tests.
- Racing unit: 8 files / 25 tests.
- Console E2E: 1 file / 1 test.
- Racing E2E: 2 files / 5 tests.
- Total: 62 files / 468 tests.
- Racing retro asset check: 6 PNG pass.
- Racing car/environment preflight: 2 runtime GLBs + 3 PS2/texture assets pass.
- Console bundle, Racing build, Engine/testkit builds, boundary/migration/trademark/reference checks: pass.
