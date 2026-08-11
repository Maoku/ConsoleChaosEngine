# SG-05 装飾の経路

| 項目 | 値 |
|---|---|
| 日付 | 2026-08-10 |
| 対象 | GRAPHICS_STAGE_PLAN SG-05 / GRAPHICS_STAGE_IMPL_PLAN §2 の判断 E |
| 成果物 | `src/render/material.ts` / `src/render/frame.ts` / `src/gameplay/scene.ts` / `tools/check-levels.ts` / `tests/unit/scene.test.ts` |
| 検査 | `npm run check:levels` / `npm run test` |

---

## 1. 塞いだ穴

**当たり判定を持たない要素は描けなかった**（上位計画 §2 の事実 5）。
`buildDrawables` が `collidersOf(level)` から始まっており、`collider` の無い要素は
そこで落ちて画面に出ない。基準画が要求する 10 種の要素のうち、
草・木・花・雲・滝・浮遊物は**当たり判定を持つべきでない**ので、この穴を塞がないと 1 つも置けない。

## 2. スキーマの変更は 0 行

`LevelEntity.collider` は元から任意で、`LevelTransform.scale` も既にある
（`src/level/schema.ts`）。足したのは次の 2 つだけである。

1. `Material.decoration: boolean`（既定 false）
2. `FrameDrawable.position: Vec3`（レベルが置いた静止位置）

大きさは `collider?.halfExtents ?? transform.scale ?? [1,1,1]`。
位置の出どころが `FrameDrawable` に要るのは、装飾が `session.bodies()` に居ないためで、
**そこにしか座標が無い**（物理を通らないものは物理から位置を引けない）。

> **装飾の位置も 0.25 単位のグリッドに載る。** `validateLevel` の `checkGrid` は
> `transform.position` を要素の区別なく見る。`scale` にはグリッド検査が掛からないので、
> 大きさは自由に決めてよい。

## 3. 「装飾」の定義は 1 つだけ

> **装飾とは、`collider` を持たない要素である。**

`Material.decoration` はこの事実の**言い換え**であって、別の定義ではない。
2 つが食い違わないことを `check-levels.ts` が同値で見る（検査 5）。

| 壊れかた | どちらの側から落ちるか |
|---|---|
| 装飾に当たり判定が生えた | `decoration && collider` |
| 当たり判定を持つものに装飾の材質が付いた | `!decoration && !collider` |

同値にしたので、**1 つの検査で両方**が落ちる。
汎用の「装飾システム」（配置ルール・散布アルゴリズム）は作っていない（§11.1.1）。

## 4. パズルに触れていないこと

`session.bodies()` は `collidersOf` から作られる。装飾はそこに居ないので、
物理にも投影にもパズルにも現れない。したがって `requiredGenerations` と `solvableIn` は
**機械的に変わりようがない**。`npm run check:levels` が毎回それを確認する。

`scene.test.ts` に 2 件足した。

- 装飾は `session.bodies()` に居ない（`collider` の有無と `decoration` が同値であることも同時に見る）
- 装飾はレベルが置いた場所に、4 世代とも見えたまま出る

## 5. 現状の数

この区切りの時点で area1 に装飾はまだ 1 つも無い（置くのは SG-06 以降）。
`check:levels` の結果は改訂前と同じである。

| ファイル | セクタ | 要素 | パズル | チェックポイント |
|---|---|---|---|---|
| `area1.json` | 8 | 72 | 6 | 8 |
| `mini.json` | 2 | 5 | 0 | 2 |
| `puzzle_lab.json` | 6 | 66 | 6 | 6 |

**経路だけが先に通っている状態**である。SG-06 / SG-07 / SG-08 が同じ経路に乗る。
