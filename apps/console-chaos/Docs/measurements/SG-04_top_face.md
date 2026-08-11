# SG-04 天面テクスチャ

| 項目 | 値 |
|---|---|
| 日付 | 2026-08-10 |
| 対象 | GRAPHICS_STAGE_PLAN SG-04 / GRAPHICS_STAGE_IMPL_PLAN §2 の判断 F |
| 成果物 | `src/render/material.ts` / `src/render/shaders/ps1_forward.glsl` / `src/render/renderer3d.ts` / `tools/check-textures.ts` |
| 検査 | `npm run test` / `npm run check:assets` |

---

## 1. 何を直したか

**箱の 6 面はすべて同じ 1 枚のテクスチャだった**（上位計画 §2 の事実 2）。
基準画の足場は天面が草・側面が砂岩のブロックで、1 枚では出せない。

足したのは 2 つだけである。

1. `Material.topTexture: string | null`（既定 null）
2. `ps1_forward.glsl` の 2 枚目のサンプラ `uTopColor`

```glsl
vec3 normal = normalize(vNormal);
vec4 base = (normal.y > 0.5 ? texture(uTopColor, uv) : texture(uBaseColor, uv)) * uBaseColorFactor;
```

`0.5` は「箱の天面」と「側面」を分ける境である。area1 の形はすべて軸に沿った箱なので、
この判定は実質 1 か 0 にしかならない。**斜面のための係数ではない。**

## 2. ドローコールは増えない

サンプラが 1 本増えただけで、描く回数も三角形の数も変わらない。
`gl.drawElements` の呼び出しは 1 材質あたり 1 回のまま。

**2 枚目を持たない材質には 1 枚目と同じ絵を束ねる。**
束ねないと GL がユニット 1 の残り（＝直前に誰かがそこへ置いた絵）を拾う。
これは `renderer3d.ts` が `FALLBACK_TEXTURE` を影の板に通しているのと同じ扱いで、
`material.test.ts` が「`uBaseColor:` を書いた数と `uTopColor:` を書いた数が一致する」を
機械的に見ている（5 か所）。

| 束ねる場所 | 2 枚目に渡すもの |
|---|---|
| `drawItem` | `material.topTexture ?? material.texture` |
| `drawPlane` | 回る面の絵（同じもの） |
| `drawShadows` | 影の板の絵（同じもの）。**板は上を向いているので 2 枚目のほうが読まれる** |
| `drawPlayerSprite` | スプライトシート（同じもの） |
| `drawPlayerModel` | 部品ごとの絵（同じもの） |

## 3. 差し替えた材質

| 種別 | 側面 | 天面 |
|---|---|---|
| `platform` | `stone_wall.png` | `grass_top.png` |
| `bridge_far` | `stone_wall.png` | `grass_top.png` |
| `island` | `stone_wall.png` | `grass_top.png` |
| `causeway`（暗室） | `stone_floor.png` | **持たない** |

暗室の `causeway` は触っていない。**空の見えない部屋に草は生えない。**
暗室かどうかは場所の話であって世代の話ではない（BR-03）ので、
`interior` が真な材質は天面を持たない、という形をテストで固定した。

## 4. 検査

`check-textures.ts` に「天面テクスチャが 4 セットすべてに揃う」を足した。
1 セットでも欠けると、その世代だけ足場の上面が**直前の誰かの絵**になる。
`material.ts` は世代を知らないので、揃っているかを見られるのはここだけである。

## 5. 画面で確かめたこと

`?scene=mini&level=area1&playtest=0` を 4 チャンネルで 1 フレームずつ描き、
`readPixels` で数えた（`window.__chaos` 経由。CRT は off）。

| チャンネル | 画面の色数 | 最も多い色 | 読み |
|---|---|---|---|
| 第4世代 | — | `[181,187,39]`（86,826 画素） | **天面の草そのもの。画面でいちばん広い色になった** |
| 第1世代 | **12** | `[76,154,236]`（空） | 12 色とも固定 54 色の中。宣言した 7 色から出ている |
| 第2世代 | 448 | 空のグラデーション | |
| 第3世代 | 1,700 | `[120,134,170]`（空＝霧の色） | |

第4世代の三角形は 8,713（カリング前）。

### 5.1 SG-11 へ持ち越す観察

第1世代で**側面（`stone_wall`）が緑に寄る**。
`stone_wall` の原画は面積の 84% が 2 色の茶（`[159,112,72]` 43% / `[176,123,80]` 41%）で、
7 色を明度順に 2 分すると**この 2 色が上位側に入り、`conifer`（緑）へ落ちる**。
`sandstone`（明度 71）と `conifer`（明度 79）は明度がほぼ同じで色相だけが違うため、
どちらへ落ちるかが絵の印象を大きく変える。

検査はすべて通っている（`stone_floor ↔ stone_wall` の明度差 107.1）。
天面が草なので「草の生えた崖」としては読めるが、
基準画の「砂岩ブロックの側面」からは離れる。**SG-11 の 4 世代の見比べで判断する**
（写像を面積で重みづけるか、`stone_wall` の割り当てを変えるか）。
