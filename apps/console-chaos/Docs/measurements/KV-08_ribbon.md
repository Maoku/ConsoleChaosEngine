# KV-08 切替の光の帯

計画は `Docs/GRAPHICS_KEY_VISUAL_PLAN.md` の KV-08（決定 5）。
基準画の D「白〜桃〜青の帯が画面を横切り、四つの世界を貫く」を実装に落とす。

画面: `kv-08_ribbon.png`（第1世代 → 第2世代の切替を 3 コマ）

---

## 1. なぜ切替の演出なのか（決定 5 の確認）

帯を世界に置くと形が 1 つ増え、当たり判定と不変条件 I1（世界の真実は 3D 1 つ）の話になる。
基準画で帯が意味しているのは**「四つの世界を行き来できること」**なので、
行き来そのもの＝チャンネル切替の瞬間に出すのがいちばん近い。

置き場は既にノイズ混合を持っている `src/render/shaders/transition.glsl`。
新しいパスは足していない。

---

## 2. 実装

```glsl
float along  = vUv.x * 0.8 + (1.0 - vUv.y) * 0.2;                 // 斜めの掃き
float center = uBlend * (1.0 + 2.0 * RIBBON_HALF_WIDTH) - RIBBON_HALF_WIDTH;
float offset = (along - center) / RIBBON_HALF_WIDTH;              // -1..1
vec3  tint   = mix(uRibbonTrail, uRibbonLead, step(0.0, offset)); // 桃が先、青が後ろ
vec3  light  = mix(tint, uRibbonCore, band * band * band);        // 芯へ寄るほど白い
```

| 値 | 中身 | 理由 |
|---|---|---|
| 帯の位置 | `uBlend` から作る | **切替の尺そのもの**を使うので、掛かる時間を 1 ミリ秒も変えない |
| 帯の幅 | 掃く向きに 0.22（両側で 0.44） | 画面外から入って画面外へ抜ける |
| 傾き | x を 0.8、y を 0.2 | 基準画と同じ向きに倒す |
| 芯の濃さの上限 | 0.82 | **真っ白にしない**（§3） |
| 色 | `key_palette.ts` から uniform で渡す | シェーダに 16 進数を置かない（KV-01 の趣旨） |

色は白 `#f8f8f8` / 桃 `#f85888` / 空色 `#1888e8` の 3 つで、
`pipeline.ts` が `KEY_COLORS` から `uRibbonCore` / `uRibbonLead` / `uRibbonTrail` へ流す。

---

## 3. 芯でも世界を覆いきらない

最初は帯の芯で完全に白へ寄せていたが、一瞬でも画面が真っ白になると
**そこで世界が切れて見える**。この演出の文言（同ファイルの冒頭）は
「ここでプレイヤーに『世界そのものは変わっていない』と伝えたい」なので、上限を 0.82 に置いた。
`kv-08_ribbon.png` の中央のコマで、帯の下に足場と雲が透けているのが確認できる。

---

## 4. 光過敏への配慮（GAME_PLAN §13）

帯の濃さは `uGlitch` を掛けたものになっている。
`glitchAmount` を 0 にした人には、**画面を横切る強い明滅も出ない。**
乱れだけ切って帯が残ると、配慮の意味がなくなる（帯のほうが面積も明度差も大きい）。

`uGlitch` は `pipeline.ts` が切替中だけ `glitchAmount()` を入れ、
それ以外は 0 にしている。したがって帯が出るのは切替の最中だけである。

---

## 5. 検査

`tests/unit/pipeline.test.ts` に 4 件を足した。

| 検査 | 落ちたときの意味 |
|---|---|
| 帯の色が `KEY_COLORS` と一致する | シェーダに 16 進数が入り、色の出どころが 2 つになった |
| 切替していない間は `uGlitch` が 0 | 常時帯が出ている |
| `glitchAmount` が 0 なら切替中でも `uGlitch` が 0 | 配慮設定が効いていない |
| 切替中は `uGlitch` が正 | 帯が出ていない |

切替に掛かる時間は `generation/transition.ts` の値のままで、
`tests/unit/switcher.test.ts` の既存の検査がそのまま通る（尺を変えていないことの担保）。
