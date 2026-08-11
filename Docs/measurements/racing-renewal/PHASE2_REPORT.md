# Racing renewal Phase 2 report

Commit base: `45ca4ae`  
Date: 2026-08-11

The production generation pipeline now accepts two generic screen-space commands:

- raster surfaces with validated/reused RGBA scanline lookup storage
- affine surfaces with a shared CPU/shader UV contract and explicit repeat/clamp

Both draw into the generation scene target between background and mesh rendering. FC/SFC palette quantization, CRT, and transition composition therefore remain downstream and unchanged.

The 3D forward shader now resolves frame-owned ambient, directional, and strongest point lights. Command-free frames use the former fixed lighting values, preserving Console output. Materials may opt into an equirectangular environment texture and strength; the renderer forces strength to zero when the hardware capability is absent, the texture was not preloaded, or strength is zero.

Contract additions:

- `video.rasterScroll`: FC only
- `video.environmentMap`: PS2 only
- `RenderFrame.rasterSurfaces` / `affineSurfaces`
- `LightCommand.direction`
- `MaterialCommand.environmentTexture` / `environmentStrength`
- recording renderer surface counts and stable optional snapshot serialization

Verification:

| Check | Result |
| --- | --- |
| Engine | 8 files / 29 tests passed |
| Workspace | 450 tests passed; all lint, boundary, asset, migration, bundle, and production build gates passed |
| Console command golden | unchanged |
| Context restore | existing 10-restore registry test passed |
| Browser shader precompile | raster, affine, light, and environment variants compiled at startup without warning/error |

No Racing-specific road, car, track, or physics vocabulary was added to Engine.
