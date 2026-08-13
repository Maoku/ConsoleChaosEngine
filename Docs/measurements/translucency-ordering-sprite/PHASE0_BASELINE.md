# Phase 0 baseline: translucency, ordering table, and scene sprites

- Date: 2026-08-12 (Asia/Tokyo)
- Baseline commit: `6156d46ee88c53ffc635f0769168e85d1f40247b`
- Host: Apple silicon (`arm64`), macOS 26.5.2 (25F84)
- Node.js: v26.0.0

## Verification

`npm run verify` passed before implementation. The baseline included:

- Engine: 8 files / 29 tests
- Engine testkit: 1 file / 1 test
- Console Chaos: 42 files / 407 tests
- Console E2E
- boundary, migration, budget, level, asset, trademark, and reference checks
- Engine, testkit, and Console Chaos production builds

## Sort benchmark

Run with:

```sh
npm run bench:sort -w @console-chaos/console-chaos -- --json
```

The unmodified naive/radix results are stored in
[`phase0-sort.json`](./phase0-sort.json). At 32,000 triangles the radix
implementation measured 0.453 ms median / 0.680 ms p95; this is the comparison
point for the Phase 5 OT12 benchmark.

## Browser captures

The captures use the development build at a 1280x720 browser viewport. The
game canvas is captured at 800x600 after waiting 700 ms for the generation
transition to finish.

World render procedure:

1. Open `/?scene=ps1`.
2. Focus the game canvas.
3. Press `1`, `2`, `3`, and `4` and capture after each transition.

Sprite-plane procedure:

1. Open `/?level=mini`.
2. Focus the game canvas.
3. Press `1` and `2` and capture after each transition.

| Capture | SHA-256 |
|---|---|
| `phase0/gen1-fc.png` | `44f2d19d0918e15c70b1d8c158c343ca719ddcf8685bbe14e38d3c74d2cdf912` |
| `phase0/gen2-sfc.png` | `b57753ce78236b9696053d9c0963616f2774da70ff970e1734d0ebb68bcb2851` |
| `phase0/gen3-ps1.png` | `67d55cad7b3cb8ed75cc8daf83124407874840aff7bd43c5d1d5edc45ee2376e` |
| `phase0/gen4-ps2.png` | `910ca170582e5266b7d46d08e795410832c18db91d9f5deaaae27528a8e2281e` |
| `phase0/gen1-fc-sprite.png` | `1801ef356a6585cd8c106e13acd3a373b13cbb1012f2754924914fc779583cae` |
| `phase0/gen2-sfc-sprite.png` | `b4082c96db71e84e5c140e2f071fc16f1688f48153ec642faea8039cb1f862d4` |

The existing command-level golden remains
`apps/console-chaos/Docs/measurements/M3_render_command_golden.json`; it covers
all four generations, the PS1-to-PS2 transition midpoint, and all puzzle views.
