# Asset provenance

作成日: 2026-08-16

このサンプルの世代非依存原画は、Codex の built-in Image Gen で作成した。`FC / SFC / PS1 / PS2` を模した画像は Image Gen から直接生成せず、世代別画像はすべて `@console-chaos/asset-pipeline` で派生させる。

## Animation source set の固定契約

`Docs/character.png` は顔、赤桃色の瞳、桃色の髪、猫耳、左側ポニーテール、紺の髪飾り、白紺の衣装、金色の留め具を固定する **character identity reference** とする。`art/source/character-upper.png` は耳から腰までの上半身構図、両腕、1024×1536 canvas、下端中央pivot、余白を固定する **composition anchor / edit target** とする。両画像は生成前に `view_image` で目視確認した。

production用character sourceは `character-{left|center|right}-{open|half|closed}.png` の9枚とし、次を全variant共通の不変条件とする。

- canvasは1024×1536、上半身の腰中央を下端中央pivotへ固定し、耳、髪、顔、襟、肩、腕、手を欠けさせない
- 同一人物、顔、猫耳、髪色、左側ポニーテール、髪飾り、衣装、配色、線、陰影、正面向きの顔、両腕を維持する
- 真正の透明背景を要求し、checkerboardや背景描画、halo、影、文字、透かしを含めない
- 変更してよいのは体の揺れ、体に遅れて動くポニーテール、指定した目の開きだけとする
- `left` は腰pivotを保ったまま上半身を画面左へ約5°傾け、ポニーテールを画面右へ遅らせる
- `center` は上半身を垂直に保ち、ポニーテールを自然な中央状態にする
- `right` は腰pivotを保ったまま上半身を画面右へ約5°傾け、ポニーテールを画面左へ遅らせる
- `open` は完全な開眼、`half` は半閉じ、`closed` は自然な閉眼とし、目以外の顔と全身を変えない

左・中央・右は全世代で共有するanimation key poseであり、promptへ世代名、pixel art、retro表現、dither、scanlineを含めない。開眼3poseはidentity referenceとcomposition anchorから1 variant 1 callで生成し、各 `half` / `closed` は対応する採用済み `open` をedit targetとして1 variant 1 callで生成する。

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

## `character-upper` reference anchor

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

## ImageGen animation source frames

9枚はすべて built-in Image Gen の `identity-preserve` 編集を1 variant 1 callで実行し、生成保存先から同名の `art/source` fileへコピーした。透明背景を要求した最初の開眼3poseはalphaを持たず、市松模様がRGBへ焼き込まれていたため不採用とした。その後、各開眼poseに対して `background-extraction` を1 callずつ行い、被写体と重ならない緑系キー背景へ置換した。採用9枚もalphaを持たないため、pipelineではこの記録に基づいてのみ `keyOut()` を使用する。

キー背景は目視上単色だが、生成由来の微小なRGB揺らぎがある。64×64左上領域のdominant RGBは下表の値で、同領域には104〜272色の近似緑が含まれる。recipeのtoleranceで背景だけを分離し、原画へ手修正は加えない。

| 採用ファイル | 編集元 | SHA-256 | canvas | alpha | dominant key RGB | 採用理由 |
|---|---|---|---:|---|---|---|
| `character-left-open.png` | identity reference + composition anchor | `0cb74238c60ce477c17801ad04e7862a6059df9364af8eff09e0615f921c1eaa` | 1024×1536 | なし | `9,249,19` | 腰位置を保った左poseと右へ遅れるポニーテール、完全な開眼が明瞭 |
| `character-left-half.png` | `character-left-open.png` | `550c4f822ba0bd0c1e88c3a9edc4d0741f4ecea2e7b0317348451bfc06e67c9b` | 1024×1536 | なし | `14,239,26` | 左poseを維持し、両眼だけが半閉じ |
| `character-left-closed.png` | `character-left-open.png` | `08e547a0765ab6273a2a204e6ad37ca74b732e3345e619d26db3567410ae6d3c` | 1024×1536 | なし | `17,233,33` | 左poseを維持し、両眼だけが自然な閉眼 |
| `character-center-open.png` | identity reference + composition anchor | `f31566adcf6929e571a0e607390dcf51c089ecf0cc0a962e5d6af68036aadc10` | 1024×1536 | なし | `10,242,14` | 垂直な中央pose、自然なポニーテール、完全な開眼が明瞭 |
| `character-center-half.png` | `character-center-open.png` | `c4b22401714e8a773ccb6709b47b6f102c8ade4e884e19a2a566e6e83ccaa56d` | 1024×1536 | なし | `15,233,22` | 中央poseを維持し、両眼だけが半閉じ |
| `character-center-closed.png` | `character-center-open.png` | `fdf750ad6fdde20f9978c1fd142c4227ba4c58346fbf1f9ab5cc4abf03472419` | 1024×1536 | なし | `16,231,21` | 中央poseを維持し、両眼だけが自然な閉眼 |
| `character-right-open.png` | identity reference + composition anchor | `199d852a199e978da83da6da12f5af2da28e893ea6cf13b72a00cd50112ad3aa` | 1024×1536 | なし | `14,232,14` | 腰位置を保った右poseと左へ遅れるポニーテール、完全な開眼が明瞭 |
| `character-right-half.png` | `character-right-open.png` | `26a304b92c0d29bc16d4168a6bc75a1d96697f0f5707e2a832775d6c7b3925fa` | 1024×1536 | なし | `23,222,24` | 右poseを維持し、両眼だけが半閉じ |
| `character-right-closed.png` | `character-right-open.png` | `d1ae4a8cd0ffc1a623572e131a215ab0785480610375bcbceb67af1e2e4067ec` | 1024×1536 | なし | `18,221,26` | 右poseを維持し、両眼だけが自然な閉眼 |

全採用画像を個別に目視し、同じ顔、猫耳、髪色、左側ポニーテール、髪飾り、衣装、配色、上半身構図、下端pivotを維持していることを確認した。開眼3poseでは肩、胴、髪、ポニーテールの輪郭差を確認し、half / closedでは指定した目以外にanimation上の意味を持つ変更がないことを確認した。

### 開眼poseの最終プロンプト

次のpromptをposeごとに独立して実行した。`{pose}` は `left` / `center` / `right`、`{direction}` は `canvas left` / `vertically centered` / `canvas right`、`{tail}` は `canvas right` / `natural centered resting state` / `canvas left` とした。centerでは「rotate ... about 5 degrees」を「keep the upper body vertically centered」に置き換えた。

```text
Use case: identity-preserve
Asset type: generation-independent source bitmap for a game title-screen character animation key pose
Input images: Image 1 is the character identity reference; Image 2 is the composition anchor and edit target
Primary request: create the {pose}/open animation key pose of the exact same cat-girl character; rotate the upper body visually about 5 degrees toward {direction} around a fixed waist-bottom pivot, while the left-side ponytail visibly lags toward {tail}; keep both eyes fully open
Subject: preserve the same face, large red-pink eyes, pink bob haircut, left-side ponytail and navy striped bow, pink-and-black cat ears, small smile, black-and-white frilled maid dress, navy neck bow with gold clasp, both arms and hands
Style/medium: preserve the polished anime illustration style, line quality, shading language, proportions, and pink, navy, white, skin, and gold palette
Composition/framing: exactly 1024x1536 portrait canvas; same centered ears-to-waist upper-body framing as Image 2; waist bottom-center remains fixed at the canvas bottom-center pivot; ears, hair, face, collar, shoulders, arms, and hands fully visible; face remains front-facing
Constraints: change only the upper-body sway and delayed ponytail direction; keep identity, anatomy, facial expression, eye shape and openness, outfit design, colors, lighting, canvas placement, bottom pivot, and all other details unchanged; genuinely transparent background with preserved clean hair edges; no checkerboard or painted backdrop; no text; no watermark; smooth high-resolution source art; no console-generation look, pixel art, retro styling, dithering, or scanlines
Avoid: redesign, identity drift, changed clothes, changed hand pose, extra or missing limbs or fingers, cropped silhouette, waist pivot movement, global translation, double tilt, halo, opaque background
```

### Animation frameのキー背景置換プロンプト

```text
Use case: background-extraction
Asset type: generation-independent game character animation source bitmap
Input images: Image 1 is the edit target
Primary request: replace only the opaque checkerboard background with one perfectly uniform flat chroma-key green background, visually equivalent to #00FF00, edge-to-edge
Constraints: preserve every character pixel and the exact {pose}/open pose: identity, face, fully open eyes, hair, cat ears, left-side ponytail direction, bows, outfit, arms, hands, body pose, waist-bottom pivot, framing, 1024x1536 dimensions, linework, colors, and shading unchanged; background must be one single solid green color with no checkerboard, gradient, texture, transparency pattern, shadow, halo, border, or other element; the character must contain no added green; no text; no watermark
Avoid: editing or restyling the character, changing pose or eyes, moving the pivot, adding shadows behind the character, checkerboard pattern, white background, transparency-grid illustration
```

### eye frameの最終プロンプト

次のpromptを6variantへ個別実行した。`{pose}` は参照open pose、`{eyes}` は `half` または `closed`、`{request}` は「naturally half-closed, with matching upper and lower eyelids」または「naturally and completely closed, drawn as relaxed matching curved eyelid lines」とした。

```text
Use case: identity-preserve
Asset type: generation-independent source bitmap for a game title-screen blink animation frame
Input images: Image 1 is the adopted {pose}/open pose and exact edit target
Primary request: create the {pose}/{eyes} blink frame by changing only both eyes from fully open to {request}
Constraints: preserve the exact same character pixels, identity, face shape, expression, eyebrows, nose, mouth, blush, hair, cat ears, left-side ponytail, bows, outfit, arms, hands, body pose, waist-bottom pivot, framing, 1024x1536 canvas, linework, colors, shading, and perfectly uniform flat chroma-key green background unchanged; do not alter pose, anatomy, silhouette, canvas placement, or background; no text; no watermark
Avoid: changing anything outside the eyelids and covered eye area, winking, asymmetric eyes, changed expression, identity drift, pose drift, background texture, checkerboard, halo, console-generation look, pixel art, retro styling
```

### 不採用出力

| variant | ImageGen保存先 | SHA-256 | 不採用理由 |
|---|---|---|---|
| `left-open` 初回 | `exec-aaa4ddd4-1d3f-4779-80a2-374c31a32c08.png` | `052857f658059f1dad09a04b3808678542cf61bf2330b4c1922e625aac1f4056` | 真正のalphaではなく市松模様がRGBへ焼き込まれていた |
| `center-open` 初回 | `exec-3b6059c2-ccce-4312-bf6b-afc9d874fa39.png` | `7552af1a0c8cafc7f3b5ebcd7d5a72da650a537fedfc56dd72ecaaad3f613802` | 真正のalphaではなく市松模様がRGBへ焼き込まれていた |
| `right-open` 初回 | `exec-c6c84b0a-51ee-4216-9d29-f76d0e2ea5b6.png` | `be47f4be830e420d9cb8971e5a1edf07d063e112f1a815ae2fd4103251b86972` | 真正のalphaではなく市松模様がRGBへ焼き込まれていた |

## 生成経路の制約

- production入力は `title-logo.png` と9つの `character-{pose}-{eyes}.png` の計10枚とする。`character-upper.png` は参照anchorであり、世代変換の入力外とする。
- 生成別の見た目調整は `tools/art.config.mjs` の recipe へ記録する。
- `public/assets/generated` のPNGは編集せず、必ず asset pipeline から再生成する。
- Image Gen に世代名を指定した直接生成、世代別の構図変更、手作業のpixel化は行わない。

## 統合検証（2026-08-16）

- `asset-manifest.json` の9つのcharacter asset IDが、同名source pathと本書記載の異なるSHA-256へ1対1で対応することを自動検査した
- `character-upper.png` がmanifestの変換入力に含まれず、builderにpose、ponytail、blinkを合成するwarp / shearが残っていないことを自動検査した
- 40出力（logo 4、全身18、FC/SFC/PS1のhalf/closed顔patch 18）の `assets:check`、共有FC 17色、RGB555、alpha mode、bounds、2回目buildのwritten 0を確認した
- PS2のhalf/closed 6出力を280×336の全身frameへ戻し、runtimeで目patch、`tweenTexture`、`textureMix`、`source-over` hardware blendを使用しないことを自動検査した
- `?generation=PS2&captureTime=0&pose={left|center|right}&eyes={open|half|closed}` の9組を1554×820で取得し、黒円、矩形edge、二重表示、欠け、console warning/errorがないことを目視確認した
