# Asset provenance

作成日: 2026-08-16

このサンプルの世代非依存原画は、Codex の built-in Image Gen で作成した。`FC / SFC / PS1 / PS2` を模した画像は Image Gen から直接生成せず、世代別画像はすべて `@console-chaos/asset-pipeline` で派生させる。

## `title-logo`

- 採用ファイル: `art/source/title-logo.png`
- Image Gen 種別: 新規生成 (`logo-brand`)
- 参照画像: なし
- SHA-256: `bcc51d439465770aecccc6922f3d92e9c8e94b3c54cf8c5a15ccbe04b44a77c6`
- 採用理由: `Console Chaos Engine` の全文が正確で、横長の輪郭と限定的な配色が強い減色後にも読み取りやすく、実アルファを持つため。

### 最終プロンプト

```text
Use case: logo-brand
Asset type: generation-independent source bitmap for a game title screen asset pipeline
Primary request: create a clean horizontal wordmark whose exact and only text is "Console Chaos Engine"
Style/medium: polished flat 2D game-title wordmark, crisp bold custom lettering, strong readable silhouette, subtle playful energy without imitating any console generation or pixel-art style
Composition/framing: one centered horizontal line, generous transparent padding, approximately 5:1 overall aspect ratio
Color palette: a restrained high-contrast palette that remains distinguishable after aggressive color quantization; dark navy outlines with warm coral and pale cream accents
Text (verbatim): "Console Chaos Engine"
Constraints: render every letter exactly; spell C-o-n-s-o-l-e C-h-a-o-s E-n-g-i-n-e; genuinely transparent background; no emblem, no mascot, no subtitle, no extra text, no trademark symbols, no mockup, no 3D extrusion, no watermark; smooth high-resolution source art; do not mimic FC, SFC, PS1, PS2, retro pixels, scanlines, dithering, or generation-specific limitations
Avoid: misspellings, duplicated letters, tiny text, scene background, texture noise
```

## `character`

- 採用ファイル: `art/source/character-upper.png`
- Image Gen 種別: 参照編集 (`identity-preserve`) と背景置換 (`background-extraction`)
- 参照画像: `Docs/character.png`
- 参照画像 SHA-256: `986ce5f967a72cb6bd8dce2ac70e58c95e08be8ce1aefbf2b5769e96691cd9f9`
- 採用ファイル SHA-256: `61f44c410eb4c6cae5ad0bb297d8014d06c008141df578bceb66907a29202abc`
- 採用理由: 顔、赤桃色の瞳、桃色の髪、猫耳、髪飾り、白紺の衣装と金色の留め具を維持し、耳から腰までと両腕が収まる上半身構図になっているため。背景はキャラクターと重ならない緑系キー背景で、builder の `keyOut()` と `cropToOpaque()` だけで決定的に分離できる。
- 背景について: 最初の編集結果は透明市松模様を RGB へ焼き込んでいたため不採用とした。採用版はキャラクターを維持したまま背景だけを緑キーへ置換した。キー色には生成由来の微小な揺らぎがあるため、recipe で許容差を明示する。

### 上半身編集プロンプト

```text
Use case: identity-preserve
Asset type: generation-independent source bitmap for a game title-screen character sprite
Input images: Image 1 is the edit target and identity anchor
Primary request: reframe the exact same cat-girl character from Image 1 as a clean upper-body cutout for a title screen
Subject: preserve her face, large red-pink eyes, pink bob haircut with the same left-side ponytail and dark bow, pink-and-black cat ears, small smile, black-and-white frilled maid dress, navy neck bow with gold clasp, and both arms; include from the top of both cat ears through the waist, with both shoulder and arm silhouettes visible
Style/medium: preserve the original polished anime illustration style, line quality, shading language, and original pink, navy, white, skin, and gold palette
Composition/framing: centered, front-facing, symmetrical usable silhouette; neutral relaxed pose; entire upper body visible; bottom edge is a clean horizontal waistline suitable as a rotation pivot; generous transparent padding around ears, hair, shoulders, elbows, and hands; portrait aspect ratio
Constraints: change only framing, pose cleanup, and background removal; keep the same recognizable character identity and outfit design; genuinely transparent background; smooth high-resolution source art; no cropped ears, hair, face, collar, shoulders, arms, or hands; no tail required; no text, props, curtains, furniture, scene, watermark; do not add or remove costume features; do not mimic FC, SFC, PS1, PS2, pixel art, dithering, scanlines, or any generation-specific limitations
Avoid: redesign, alternate hairstyle, different eye color, extra limbs or fingers, chibi proportions, opaque background, white halo, edge fringe
```

### キー背景置換プロンプト

```text
Use case: background-extraction
Asset type: generation-independent game character source bitmap
Input images: Image 1 is the edit target
Primary request: change only the checkerboard background to one perfectly uniform, flat chroma-key green background with RGB exactly or visually equivalent to #00FF00
Constraints: preserve every character pixel, identity, face, eyes, hair, cat ears, bow, outfit, arms, hands, pose, framing, dimensions, linework, colors, and shading unchanged; background must be one single solid green color edge-to-edge with no checkerboard, gradient, texture, shadow, halo, border, transparency preview pattern, or other elements; the character must contain no green; no text; no watermark
Avoid: editing or restyling the character, adding shadows behind the character, checkerboard pattern, white background, transparency-grid illustration
```

## 生成経路の制約

- `art/source` の2ファイルだけを Image Gen 由来の入力とする。
- 生成別の見た目調整は `tools/art.config.mjs` の recipe へ記録する。
- `public/assets/generated` のPNGは編集せず、必ず asset pipeline から再生成する。
- Image Gen に世代名を指定した直接生成、世代別の構図変更、手作業のpixel化は行わない。
