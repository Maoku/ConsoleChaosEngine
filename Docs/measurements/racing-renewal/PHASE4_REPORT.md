# Racing Renewal Phase 4 Report

Date: 2026-08-11

## Result

Phase 4 replaces both 3D car placeholders with deterministic runtime conversions of the supplied source GLBs and adds generation-specific 3D presentation.

### Runtime car conversion

`apps/racing/tools/prepare-car-models.ts` directly repacks the renderer-required accessor buffer views. It does not round-trip geometry through an authoring tool, so `POSITION`, `NORMAL`, `TEXCOORD_0`, and indices remain byte/value equivalent. The Gen4 identity node matrix is removed, and embedded base color images are extracted and resized with `sips`. Normal and metallic/roughness images are not copied to either runtime GLB.

`apps/racing/tools/check-car-models.ts` verifies source hashes, output hashes, canonical geometry fingerprints, triangle counts, node matrices, stripped images/materials, texture dimensions, size budgets, and the production Engine loader.

| Generation | Source GLB | Runtime GLB | Triangles | Canonical fingerprint | Runtime model | Base color |
| --- | --- | --- | ---: | --- | ---: | --- |
| PS1 | `data/gen3_car.glb` | `public/assets/gen3/models/car.glb` | 978 | `563cd6ac12debde11146595b4b4543a131407876e3474b14267e7ade40bc8146` | 63,524 bytes | 256×256 PNG / 126,165 bytes |
| PS2 | `data/gen4_car.glb` | `public/assets/gen4/models/car.glb` | 13,618 | `e61d6376caa5f25d55099d8cf170626ac5a34144d03e79828cb86b2e4194ae50` | 593,132 bytes | 1024×1024 PNG / 1,261,377 bytes |

Two consecutive converter runs produced identical SHA-256 values for both runtime GLBs, both textures, and `car-conversion.json`.

### Presentation

- PS1 loads the 978-triangle model with 256px base color, nearest filtering, profile-driven vertex quantization/affine UV, and triangle sorting. It has no environment material command.
- PS2 loads the 13,618-triangle model with 1024px base color, depth, ambient/directional/point commands, a shadow, and equirectangular environment reflection on the car material only.
- The source front axis is `-X`; both builders apply the same `rotationY = -heading + PI` correction while preserving gameplay coordinates.
- Player and AI share one loaded geometry per generation and differ through tint/command identity.
- The common chase camera was lowered to make the supplied car silhouette readable. FC/SFC screen-space surfaces and sprites are unaffected.
- `phase4-ps1.png` and `phase4-ps2.png` are production browser captures. The DOM reported `CH 3 / POLYGON` and `CH 4 / BROADBAND`; no Vite error overlay was present.

### PS2 environment

Final runtime path: `apps/racing/public/assets/gen4/environment/circuit.png`

- Size: 1024×512
- Runtime bytes: 732,024
- RGB profile: present
- Source ImageGen output: `/Users/maoku/.codex/generated_images/019ff0aa-4790-77e3-b7aa-c9a7adce6589/exec-0a7d4df3-8cb3-478a-bc4f-bea8da92f208.png`
- Generation mode: built-in ImageGen

Exact prompt:

```text
Use case: stylized-concept
Asset type: equirectangular environment texture for a fictional early-2000s console racing game
Primary request: seamless-looking full 360-degree 2:1 latitude-longitude coastal circuit panorama for lightweight car reflections. Bright blue sky across the upper half, a low ring of distant teal mountains and sparse pine-covered shoreline exactly around the horizon, turquoise sea glimpses, pale concrete pit buildings without signs, and warm asphalt/grass colors near the lower nadir.
Style/medium: clean stylized early-2000s game environment, saturated but natural color blocks, moderate detail, reflection-readable broad shapes, no photorealistic tiny detail.
Composition/framing: strict equirectangular 2:1 panorama, level horizon centered vertically, left and right edges visually compatible, sky continuous at zenith, ground compressed toward nadir, no foreground vehicle.
Lighting: single soft sun glow from upper-left, broad white cloud bank opposite it, readable high-contrast reflection bands.
Constraints: no text; no UI; no logos; no trademarks; no watermark; no vehicles; no people; no fisheye frame; no black borders.
Avoid: cubemap cross layout, ordinary perspective photo, visible seam, tilted horizon, branded billboards, racing logos, hyperreal photography.
```

## Verification

- Racing unit: 7 files / 20 tests pass.
- Car preflight: both source/runtime fingerprints match; Engine loader passes.
- Environment preflight: 1024×512, 732,024 bytes, RGB profile present.
- Browser: PS1 and PS2 models render through production WebGL; PS2 capture shows frame-command lighting/reflection.
