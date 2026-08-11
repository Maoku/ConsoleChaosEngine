# Racing renewal Phase 0 gate report

Date: 2026-08-11 (Asia/Tokyo)  
Baseline commit: `c080ea6`  
Implementation plan: `Docs/RENEWAL_RACING_GAME_IMPLEMENTATION_PLAN.md`

## Specification decision

The contradictory model sentence in `Docs/RENEWAL_RECING_GAME.md` is corrected: FC/SFC use generated 2D assets; PS1/PS2 use the supplied Gen3/Gen4 GLBs. This is now a closed decision.

## Baseline

Host:

- macOS 26.5.2 (25F84)
- Apple A18 Pro, 5-core GPU, Metal supported
- Node.js 26.0.0
- browser capture viewport 1280×720; game canvas 1280×685
- baseline renderer is Canvas 2D, so a WebGL renderer string is not applicable

Verification:

| Check | Result |
| --- | --- |
| Engine unit | 5 files / 19 tests passed |
| Engine testkit | 1 file / 1 test passed |
| Racing unit | 4 files / 9 tests passed |
| Racing lifecycle E2E | 1 file / 1 test passed |
| Workspace verify | 48 files / 438 tests passed; all lint/boundary/asset/build gates passed |
| Racing production build | 36.38 kB JS / 14.11 kB gzip |

The baseline capture is [`phase0-baseline.png`](phase0-baseline.png). It records the current shared top-down/polyline presentation that is intentionally replaced by later phases.

## Renderer spikes

- Raster surface integration point: generation scene drawing occurs before FC/SFC quantization and CRT passes; transition rendering invokes the same scene callback for both source and target generations. The production pass will therefore draw into each generation scene target rather than bypassing the pipeline.
- Affine contract: `uv = origin + localPixel.x * stepX + localPixel.y * stepY`, with top-left pixel coordinates and explicit repeat/clamp behavior. CPU corner/center fixtures are committed in `racing-renewal-spikes.test.ts`.
- Environment contract: camera-to-fragment incident vector is reflected around the world normal, then mapped with `u = fract(0.5 + atan2(z, x) / 2π)` and `v = acos(y) / π`. Cardinal/reflection fixtures are committed beside the affine fixtures.

## Vehicle audio spike

The first implementation will use parameterized overlap one-shots, not a new sustained-voice API:

- 20 Hz update interval (50 ms)
- 100 ms nominal player tone, therefore two overlapping vehicle voices at steady speed
- FC arrangement limited to three simultaneous musical roles, leaving two of five hardware voices for vehicle sound
- race cue/brake requests use the existing low-priority one-shot path, which steals an older one-shot before BGM

The continuous generic voice API remains out of scope unless browser PCM/performance validation finds audible gaps or unbounded allocation.

## Source GLB preflight

| Asset | SHA-256 | Loader | Triangles | Bounds size | Front |
| --- | --- | --- | ---: | --- | --- |
| Gen3 | `5e48569c625a00cf549069be7eb90b9bd6e87b23164bb92ad06480ee84a76c2e` | pass | 978 | 1.879 × 0.481 × 0.865 | `-X` |
| Gen4 | `b00d08a2f81790a39bdd8fb6f5c2214cb0bf0b15a1c61edc033fbb00de846c94` | fails on identity `node.matrix` as expected | 13,618 | 1.906 × 0.497 × 0.881 | `-X` |

The +X images show the rear and the -X images show the nose:

- `gen3-preflight-plus-x.png`, `gen3-preflight-minus-x.png`
- `gen4-preflight-plus-x.png`, `gen4-preflight-minus-x.png`

## Style and HUD direction

[`style-frame.png`](style-frame.png) fixes the shared art direction: a fictional compact wedge-shaped yellow player car, red rival, graphite coastal circuit, cream/red curbs, green verge, blue mountain horizon, and the same rear chase composition across all generations.

The built-in ImageGen prompt was:

> A single clean 2×2 comparison sheet showing the same compact yellow wedge-shaped fictional racing car, red rival, and coastal circuit in authentic 8-bit raster-road, 16-bit affine-ground, late-1990s low-poly, and early-2000s lit/environment-reflected treatments; exact equal panels, consistent rear chase composition, no brand, logo, text, UI, watermark, top-down camera, or motion blur.

HUD remains DOM-owned. It uses compact monospace status, generation/lap/rank/time, a centered countdown/result panel, and `aria-live` only for start/lap/finish announcements.
