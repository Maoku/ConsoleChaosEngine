# Racing Renewal Phase 3 Report

Date: 2026-08-11

## Result

Phase 3 adds a read-only `RaceVisualState`, FC raster-road presentation, SFC affine-ground presentation, generated retro assets, screen-space sprite priority, and one-frame generation masks for transition composition.

- FC uses one 144-row reused `Float32Array`; stop/straight/left/right/off-track signatures are unit-test goldens.
- SFC derives `uvOrigin`, `uvStepX`, and `uvStepY` from course progress, track-relative heading, and curve.
- FC and SFC commands are both present in the same `RenderFrame`, while the production pipeline selects the active/transition generation.
- AI cars are sorted far-to-near, perspective-scaled, horizontally perspective-compressed, and drawn before the player.
- `RaceVisualState` copies presentation values and passes a deep mutation test against `RaceState`.
- Screen-space sprites use generation-target pixel coordinates and do not change the existing world-space sprite default.

Browser captures:

- `phase3-fc.png`: FC fixed-palette/raster/CRT output with player and AI on the raster road.
- `phase3-sfc.png`: SFC RGB555/affine/CRT output with player and AI on the affine surface.
- Browser DOM confirmed `CH 1 / 8-BIT` and `CH 2 / 16-BIT`; no Vite error overlay was present.

## Final assets and validation

The built-in ImageGen mode produced the source images. The image-generation chroma-key helper removed the solid green atlas background, and `apps/racing/tools/finalize-retro-images.py` performs deterministic green-spill cleanup, binary alpha, palette reduction, dimension checking, and seam measurement.

| Runtime asset | Dimensions | Final RGBA colors | Transparent pixels |
| --- | ---: | ---: | ---: |
| `apps/racing/public/assets/gen1/sprites/cars.png` | 384×256 | 25 | 71,968 |
| `apps/racing/public/assets/gen1/backgrounds/coast.png` | 512×192 | 24 | 0 |
| `apps/racing/public/assets/gen1/road/road.png` | 256×256 | 14 | 0 |
| `apps/racing/public/assets/gen2/sprites/cars.png` | 384×256 | 127 | 71,107 |
| `apps/racing/public/assets/gen2/backgrounds/coast.png` | 512×192 | 127 | 0 |
| `apps/racing/public/assets/gen2/tiles/circuit.png` | 256×256 | 128 | 0 |

Source outputs:

- `/Users/maoku/.codex/generated_images/019ff0aa-4790-77e3-b7aa-c9a7adce6589/exec-caec100b-429c-40ab-af3d-4fc39988a7c7.png`
- `/Users/maoku/.codex/generated_images/019ff0aa-4790-77e3-b7aa-c9a7adce6589/exec-27f237dc-7cc1-449c-af4f-cf06163e23dc.png`
- `/Users/maoku/.codex/generated_images/019ff0aa-4790-77e3-b7aa-c9a7adce6589/exec-acb833ed-6720-471b-ae25-d4fc3070a617.png`
- `/Users/maoku/.codex/generated_images/019ff0aa-4790-77e3-b7aa-c9a7adce6589/exec-9e9cf061-6ced-4341-9a98-802ad420b9cc.png`
- `/Users/maoku/.codex/generated_images/019ff0aa-4790-77e3-b7aa-c9a7adce6589/exec-2e508843-a5d9-49d8-a150-45dab1717953.png`
- `/Users/maoku/.codex/generated_images/019ff0aa-4790-77e3-b7aa-c9a7adce6589/exec-aa85e37d-389b-47e1-a9ee-3dd15305ca1e.png`

## Exact ImageGen prompt set

### FC car atlas

```text
Use case: stylized-concept
Asset type: 8-bit racing game car sprite atlas
Primary request: exact 3-column by 2-row sprite sheet of the same fictional compact wedge-shaped racing car for a rear chase-camera game.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local background removal, filling every cell and all gutters uniformly.
Subject: top row yellow player car #F5C542; bottom row red rival car #CA3C55. In each row: column 1 rear-left three-quarter view, column 2 straight rear view, column 3 rear-right three-quarter view. Every car is centered within its equal cell, same apparent size, fully visible, with generous padding.
Style/medium: authentic late-1980s 8-bit pixel-art sprite, hard-edged square pixels, very limited fixed palette, strong readable silhouette, no antialiasing, no soft shading.
Composition/framing: exact 3x2 equal grid alignment but no drawn grid lines; six isolated sprites only.
Constraints: background must be one uniform #00ff00 with no shadows, gradients, texture, floor, reflections, or lighting variation; crisp edges; do not use #00ff00 in cars; no cast shadow; no text; no logos; no trademarks; no watermark.
Avoid: front views, side-only views, modern 3D rendering, mismatched car designs, cropped wheels, extra cars, labels, cell borders.
```

### SFC car atlas

```text
Use case: stylized-concept
Asset type: 16-bit racing game car sprite atlas
Primary request: exact 3-column by 2-row sprite sheet of the same fictional compact wedge-shaped racing car for a rear chase-camera game.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local background removal, filling every cell and all gutters uniformly.
Subject: top row yellow player car #F5C542; bottom row red rival car #CA3C55. In each row: column 1 rear-left three-quarter view, column 2 straight rear view, column 3 rear-right three-quarter view. Every car is centered within its equal cell, same apparent size, fully visible, generous padding.
Style/medium: authentic early-1990s 16-bit pixel-art sprite, crisp pixel clusters, RGB555-style richer color, restrained dithered shading, readable tail lamps and rear window, no antialiasing.
Composition/framing: exact 3x2 equal grid alignment but no drawn grid lines; six isolated sprites only.
Constraints: background must be one uniform #00ff00 with no shadows, gradients, texture, floor, reflections, or lighting variation; crisp edges; do not use #00ff00 in cars; no cast shadow; no text; no logos; no trademarks; no watermark; keep the exact same car design across all cells.
Avoid: front views, side-only views, smooth modern 3D rendering, mismatched designs, cropped wheels, extra cars, labels, borders.
```

### FC coast background

```text
Use case: stylized-concept
Asset type: 8-bit racing game parallax background
Primary request: wide side-to-side looping coastal race horizon background, with distant dark-blue pixel mountains, a narrow cyan sea band, small white blocky clouds, and a deep blue sky.
Style/medium: authentic late-1980s 8-bit pixel art, hard square pixels, fixed very limited palette, flat color clusters, no antialiasing.
Composition/framing: very wide landscape strip, horizon in the lower third, similar visual weight at left and right edges so horizontal repeat is unobtrusive, no road and no foreground car.
Color palette: deep blue sky, cyan sea, navy mountains, white clouds, tiny green shoreline.
Constraints: no text; no UI; no logos; no trademarks; no watermark; no sun disk; no gradients; no photorealism; no vehicles; no track.
Avoid: vertical composition, detailed foreground, smooth painting, modern pixel-art glow, lens effects.
```

### SFC coast background

```text
Use case: stylized-concept
Asset type: 16-bit racing game parallax background
Primary request: wide side-to-side looping coastal race horizon background with layered forested mountains, turquoise sea, a few crisp white clouds, and a bright blue sky.
Style/medium: authentic early-1990s 16-bit pixel art, crisp pixel clusters, RGB555-like color, restrained ordered dithering, no antialiasing.
Composition/framing: very wide landscape strip, horizon in the lower third, matching visual density at left and right edges for unobtrusive horizontal repeat, no road and no foreground car.
Color palette: saturated blue sky, turquoise sea, blue-green mountain layers, cream shoreline, white clouds.
Constraints: no text; no UI; no logos; no trademarks; no watermark; no vehicles; no track; no gradients or photorealistic rendering.
Avoid: vertical composition, detailed foreground, smooth digital painting, lens flare, glow, modern high-resolution realism.
```

### FC road texture

```text
Use case: stylized-concept
Asset type: seamless 8-bit raster-road source texture
Primary request: perfectly top-down straight race-road texture tile running vertically through the exact center from top edge to bottom edge; medium-gray asphalt fills the central 56 percent, narrow alternating cream/red curb strips on both sides, flat dark-green grass outside, a thin dashed cream center line repeating vertically.
Style/medium: authentic late-1980s 8-bit pixel art, fixed limited palette, hard square pixels, no antialiasing, simple repeated pattern.
Composition/framing: exact orthographic top-down square tile; bilateral symmetry; road connects seamlessly across top and bottom edges; left and right edges are plain matching grass.
Constraints: seamless top-bottom tiling; no perspective; no curve; no vehicles; no scenery; no text; no logos; no trademarks; no watermark; no shadows; no gradient.
Avoid: isometric view, chase camera, photorealistic asphalt, diagonal road, lane count changes, objects on grass.
```

### SFC circuit tile

```text
Use case: stylized-concept
Asset type: seamless 16-bit affine-ground road tile
Primary request: perfectly top-down straight race-road texture tile running vertically through the exact center from top edge to bottom edge; graphite asphalt fills the central 54 percent, alternating cream/red curb strips on both sides, detailed blue-green grass outside, and a crisp dashed cream center line repeating vertically.
Style/medium: authentic early-1990s 16-bit pixel art, RGB555-like color, crisp pixel clusters, restrained ordered dithering, no antialiasing.
Composition/framing: exact orthographic top-down square tile; bilateral symmetry; all road, curb, and line patterns connect seamlessly across top and bottom; left and right edges are matching grass for repeat.
Constraints: seamless top-bottom and unobtrusive full-tile repeat; no perspective; no curve; no vehicles; no scenery; no text; no logos; no trademarks; no watermark; no shadows; no gradient.
Avoid: isometric view, chase camera, photorealistic materials, diagonal road, objects on grass, lane count changes.
```

## Verification

- Racing unit: 6 files / 16 tests pass.
- Racing TypeScript lint: pass.
- Engine TypeScript lint: pass.
- Asset finalizer/checker: all six images pass dimension, palette, and alpha checks.
- Production browser: FC and SFC captures render through palette/RGB555, CRT, and generation transition targets.
