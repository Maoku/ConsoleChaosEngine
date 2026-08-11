# Racing renewal Phase 1 report

Commit base: `c97d218`  
Date: 2026-08-11

Racing now starts through the production generation WebGL renderer and generation audio service. The renderer preloads an app-owned manifest, GameHost and renderer share one AssetManager, and the prior polyline/circle/Canvas-only presentation has been replaced by box/quad-compatible WebGL placeholders.

HUD status is app-owned DOM. `RenderFrame.overlays` remains empty while generation, lap, rank, time, countdown, result, restart guidance, and limited `aria-live` announcements remain visible.

Verification:

| Check | Result |
| --- | --- |
| Racing typecheck | pass |
| Racing unit | 5 files / 11 tests passed |
| Racing lifecycle E2E | 1 file / 1 test passed |
| Engine testkit | 1 file / 1 test passed |
| Racing production build | 114.26 kB JS / 43.07 kB gzip |
| Browser preload/start | pass; no console warning/error |
| DOM HUD | generation/lap/rank/time/start announcement present |

[`phase1-webgl.png`](phase1-webgl.png) is the browser capture of the production path. Art is intentionally placeholder-quality until Phase 3/4; the gate proves the renderer, post-processing, lifecycle, and DOM HUD integration path.
