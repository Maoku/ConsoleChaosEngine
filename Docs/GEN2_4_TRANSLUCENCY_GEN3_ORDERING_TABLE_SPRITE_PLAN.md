# Gen2〜4 半透明・Gen3 オーダリングテーブル・擬似スプライト実装計画

> 作成日: 2026-08-12  
> 対象: `@console-chaos/engine` の世代別 WebGL 描画経路  
> 状態: 実装前

## 1. 目的

次の三つを、互いに矛盾しない一つの描画基盤として実装する。

1. Gen2、Gen3、Gen4 の半透明を、各世代の実機に近い演算へ分ける。
2. Gen3 のポリゴンソートへ長さ 12 のオーダリングテーブルを導入する。
3. Gen1、Gen2 専用になっている `SpriteCommand` を Gen3、Gen4 でも擬似スプライトとして描く。

本エンジンは命令・タイミング単位のエミュレータではないため、全レジスタの完全再現は目標にしない。
一方で、現在の「Gen2〜4 をすべて同じ加算合成で描く」状態は廃止し、ゲームから見える描画順と
代表的なハードウェア合成式は明示的に再現する。

## 2. 現状と問題

### 2.1 半透明

- `packages/engine/src/generation/profiles.ts` は Gen2〜4 をすべて `alphaBlend: true` とだけ表現する。
- `MaterialCommand.blendMode` は `opaque | alpha | additive` の三値だが、
  `webgl-renderer.ts` の半透明パスは材質の区別なく `blend: 'add'` を適用する。
- `gl/state.ts` の `sub` は存在するものの、世代別解決や固定係数、RGB/Alpha 個別設定を持たない。
- 半透明はメッシュだけが対象で、`SpriteCommand` は共通の合成指定を持たない。

このため、Gen2 のカラー加減算、Gen3 の四つの半透明率、Gen4 の通常 Alpha や乗算を
同じ見た目に潰している。

### 2.2 Gen3 ソート

- 深度バッファを持たない世代では、全メッシュを中心点の距離で一つの配列へ集めてソートする。
- `polygonSort` 材質は、モデル内部の全三角形を 16 bit キーの基数ソートへ掛ける。
- メッシュ、スキンメッシュ、スプライトが別パスなので、種類をまたぐ描画順を宣言できない。
- `order.slice(0, count).sort(...)` による毎フレーム割り当てが残る。
- UI をフレーム内へ描く場合に、3D シーンより必ず後になるという契約がない。

### 2.3 SpriteCommand

- Gen1、Gen2 だけが独立したスプライト用 FBO を持つ。
- Gen3、Gen4 は `spriteTarget` が `null` で、`drawSprites` 自体が呼ばれない。
- `screenSpace` は型に存在するが、Gen3、Gen4 のシーン内描画へ接続されていない。
- ワールド空間スプライトをカメラへ正対させるビルボード行列がない。
- WebGL 経路は `SpriteCommand.layer` を描画順へ反映していない。

## 3. 設計原則

1. 描画対象を一度、内部 `DrawPacket` へ正規化する。
2. Gen3 だけは `DrawPacket` を長さ 12 のオーダリングテーブルへ登録する。
3. 半透明式はゲーム側の材質指定とハードウェアプロファイルから解決する。
4. Gen1、Gen2 のスプライト面は維持し、既存のパレット分離を壊さない。
5. Gen3、Gen4 のスプライトは 3D シーン内の `DrawPacket` として扱う。
6. 作業配列、テーブル、ブレンド用リソースは起動時に確保し、フレーム中に増やさない。
7. 既存 API は追加フィールド省略時に現在と同じコマンドを構築できるようにする。

描画の基本フローは次とする。

```text
RenderFrame
  -> visible/generation filter
  -> DrawPacket へ正規化
  -> 世代別順序付け
       Gen1/2: scene + 独立 sprite plane
       Gen3  : OrderingTable[12]
       Gen4  : opaque/depth + translucent + screen-space
  -> 世代別ブレンド状態
  -> quantize / CRT / transition
```

## 4. 公開 API の変更

### 4.1 HardwareGenerationProfile

`alphaBlend` は互換用に残し、次の能力を追加する。

```ts
export type TranslucencyProfile =
  | { kind: 'none' }
  | {
      kind: 'color-math';
      colorBits: 5;
      operations: readonly ['add', 'subtract'];
      halfResult: true;
      fixedColor: true;
    }
  | {
      kind: 'fixed-rate';
      modes: readonly ['average', 'add', 'subtract', 'quarter-add'];
      orderingTableLength: 12;
    }
  | {
      kind: 'gs-alpha';
      sourceAlpha: true;
      destinationAlpha: true;
      fixedAlpha: true;
    };
```

プロファイル値は次とする。

| 世代 | `translucency.kind` | 備考 |
|---|---|---|
| Gen1 / FC | `none` | 半透明なし |
| Gen2 / SFC | `color-math` | Main/Sub または固定色の加減算、1/2 |
| Gen3 / PS1 | `fixed-rate` | 四つの固定半透明率、OT 長 12 |
| Gen4 / PS2 | `gs-alpha` | Source/Destination/固定 Alpha を使う合成 |

スプライト経路もパレット方式から暗黙に推測せず、次を能力として追加する。

```ts
spriteComposition: 'separate-plane' | 'scene';
```

### 4.2 HardwareBlendCommand

`MaterialCommand` と `SpriteCommand` が共有できる合成コマンドを追加する。

```ts
export type HardwareBlendCommand =
  | {
      family: 'portable';
      operation: 'alpha' | 'add' | 'subtract' | 'multiply';
      opacity?: number;
    }
  | {
      family: 'gen2-color-math';
      operation: 'add' | 'subtract';
      half: boolean;
      operand?: 'subscreen' | 'fixed';
      fixedColor?: readonly [number, number, number];
    }
  | {
      family: 'gen3-semitransparency';
      mode: 'average' | 'add' | 'subtract' | 'quarter-add';
    }
  | {
      family: 'gen4-gs';
      preset: 'source-over' | 'fixed-alpha' | 'add' | 'subtract' | 'multiply';
      opacity?: number;
    };
```

追加先:

```ts
interface MaterialCommand {
  hardwareBlend?: HardwareBlendCommand;
}

interface SpriteCommand {
  hardwareBlend?: HardwareBlendCommand;
}
```

`blendMode` は互換入力として残し、内部で `portable` へ変換する。新しい実装からは
`hardwareBlend` を優先する。

世代固有 family と `generations` mask が矛盾する場合は、開発時に明確なエラーを出す。
Gen1 で半透明指定されたコマンドは暗黙に Alpha 合成せず、既定では描画しない。

### 4.3 描画順 API

次の型を公開する。

```ts
export const GEN3_ORDERING_TABLE_LENGTH = 12;

export type OrderingTableIndex =
  | 0 | 1 | 2 | 3 | 4 | 5
  | 6 | 7 | 8 | 9 | 10 | 11;

export interface OrderingCommand {
  orderTableIndex?: OrderingTableIndex;
  polygonSortRange?: readonly [OrderingTableIndex, OrderingTableIndex];
}
```

`MeshCommand`、`SkinnedMeshCommand`、`SpriteCommand`へ `OrderingCommand` のフィールドを追加する。

- `orderTableIndex`: 描画用途を固定するコマンド向け。
- `polygonSortRange`: 三角形を複数の OT slot へ分割するモデル向け。
- 省略時はコマンド種別と深度から既定 slot を決定する。
- `layer` は Gen1、Gen2 と Canvas fallback の互換用に残す。

### 4.4 SpriteCommand

ワールド空間擬似スプライト用に次を追加する。

```ts
interface SpriteCommand {
  billboard?: 'cylindrical' | 'spherical' | 'none';
  depthWrite?: boolean;
}
```

- `screenSpace: false` の既定 billboard は `cylindrical`。
- `screenSpace: true` は billboard を使わず、内部解像度ピクセルで描く。
- Alpha 抜きスプライトは深度書き込みありを既定とする。
- 半透明スプライトは深度書き込みなしを強制する。

## 5. Gen3 オーダリングテーブル

### 5.1 テーブル構造

`packages/engine/src/render/ordering-table.ts` を新設する。

```ts
interface OrderingTableWorkspace {
  readonly lists: readonly DrawPacket[][]; // 常に length 12
  reset(): void;                           // 各 list.length = 0
}
```

配列と各リストはレンダラ作成時に一度だけ確保する。`reset()` は参照を捨てず長さだけ戻す。

### 5.2 既定 slot

| Index | 既定用途 |
|---:|---|
| 0 | 背景、最奥の固定面 |
| 1〜8 | 3D ワールド。遠方から近景へ量子化 |
| 9 | 半透明、合成エフェクト |
| 10 | screen-space sprite、ゲーム画面内 UI |
| 11 | デバッグ描画 |

用途を固定したいコマンドは `orderTableIndex` を明示する。通常ワールドはカメラ空間 Z を
1〜8へ量子化する。距離二乗ではなく view-space depth を用い、画面端の物体で順序が反転しにくくする。

### 5.3 リスト内順序

- まず不透明、次に半透明を登録する。
- 不透明は遠方から近景へ安定ソートする。
- 半透明も遠方から近景へ安定ソートする。
- 同じ深度キーは RenderFrame への投入順を維持する。
- screen-space とデバッグ slot は原則投入順を維持する。
- テーブルそのものは必ず index 0 から 11 へ走査する。

これにより、半透明描画時には既に背景・不透明物がフレームバッファへ存在する。
WebGL のブレンドで現在の fragment color `Cs` と既存 framebuffer color `Cd` を利用できる。

### 5.4 三角形単位の分割

`polygonSort: true` のモデルは、全三角形を完全順位へソートする代わりに次の処理を行う。

1. 三角形重心を view-space depth へ変換する。
2. `polygonSortRange`、既定 `[1, 8]` の slot へ量子化する。
3. counting pass で slot ごとの三角形数を数える。
4. 安定 partition で一つの動的 index buffer へ並べる。
5. 各 slot の `firstIndex/count` を `DrawPacket` として登録する。
6. テーブル走査時に該当 range だけ `drawElements` する。

計算量は O(n + 12) とし、比較ソートと一時配列を使わない。既存の
`sortTrianglesByDepthRadix` はベンチ比較とフォールバックのため残す。

## 6. 世代別半透明

### 6.1 GL state の拡張

`packages/engine/src/render/gl/state.ts` の文字列 blend state を、次を保持する正規化状態へ変更する。

- RGB/Alpha の equation
- RGB/Alpha の source factor
- RGB/Alpha の destination factor
- constant blend color
- blend enable

使用する WebGL2 API:

- `blendEquationSeparate`
- `blendFuncSeparate`
- `blendColor`

状態比較は値ベースで行い、同じ状態の再設定を避ける。fake GL にも対応 API と定数を追加する。

### 6.2 Gen2

再現対象:

- `main + sub`
- `(main + sub) / 2`
- `main - sub`
- `(main - sub) / 2`
- fixed color operand

演算前後の値を RGB555 基準へ丸める CPU 参照関数を用意し、GPU 結果のゴールデンに使う。
既存 SFC 量子化パスは維持するが、二重丸めで既存の不透明色が変化しないよう、
半透明サンプルを使って量子化位置を確定してから統合する。

### 6.3 Gen3

次の四モードを固定係数で実装する。

| モード | 式 |
|---|---|
| `average` | `Cd * 0.5 + Cs * 0.5` |
| `add` | `Cd + Cs` |
| `subtract` | `Cd - Cs` |
| `quarter-add` | `Cd + Cs * 0.25` |

結果はチャンネル範囲へ clamp する。半透明コマンドは OT の既定 slot 9 へ入り、
必要ならゲーム側が別 slot を明示できる。複数の半透明を重ねる場合は、同一リスト内の
遠方から近景の順で逐次合成する。

### 6.4 Gen4

最初の実装では、GS の一般式からゲームで使う代表的なプリセットを公開する。

- source-over alpha
- fixed alpha
- additive
- subtractive
- multiply

通常の Alpha は深度テストあり、深度書き込みなしとする。任意の A/B/C/D selector 全組み合わせは
今回の公開 API には含めない。将来必要になった場合は、固定機能で表現できない式だけを
事前確保した ping-pong compositor へ送る。

## 7. Gen3、Gen4 擬似スプライト

### 7.1 経路

`generation-pipeline.ts` の責務を次へ分ける。

| 世代 | 描画先 | 順序・深度 |
|---|---|---|
| Gen1 | 独立 sprite plane | 既存 layer / 走査線制限 |
| Gen2 | 独立 sprite plane | 既存 layer / RGB555 合成 |
| Gen3 world | scene target | OT 1〜9、深度なし |
| Gen3 screen | scene target | OT 10、深度なし |
| Gen4 world | scene target | depth test、用途別順序 |
| Gen4 screen | scene target | world 後、depth 無効 |

Gen3、Gen4 では `drawScene()` が sprite packet も収集する。独立 plane 用の `drawSprites()` は
Gen1、Gen2 のみに呼ぶ。

### 7.2 ビルボード

専用 sprite shader またはモデル行列で、カメラの right/up ベクトルから板の向きを作る。

- `cylindrical`: Y 軸を固定して水平方向だけカメラへ向ける。
- `spherical`: 上下方向も含めてカメラへ正対する。
- `none`: コマンドの向きをそのまま使う。

Gen3 では頂点量子化と nearest filter を適用し、Gen4 では linear filter を適用する。
スプライトは既定で unlit とし、霧はワールドスプライトだけに適用する。

## 8. 実装フェーズ

### Phase 0: 基準固定

- `npm run verify` の現在結果を記録する。
- Gen1〜4 の既存代表画面を採取する。
- `bench-sort.ts -- --json` の結果を保存する。
- 現在の半透明画面と FC/SFC sprite 画面を比較基準にする。

### Phase 1: 型と CPU 参照

対象:

- `packages/engine/src/generation/profiles.ts`
- `packages/engine/src/render/frame.ts`
- 新規 `packages/engine/src/render/blend.ts`
- 新規 `packages/engine/src/render/ordering-table.ts`
- `packages/engine/src/index.ts`

作業:

- 新しい profile、blend、ordering 型を追加する。
- 合成式と OT slot 計算の純粋関数を実装する。
- 既存コマンド省略時の snapshot が変わらないことを確認する。

### Phase 2: DrawPacket と OT

対象:

- `packages/engine/src/render/webgl-renderer.ts`
- `packages/engine/src/render/sort.ts`
- `packages/engine/src/render/gl/buffer.ts`

作業:

- mesh、skinned mesh、sprite を内部 DrawPacket へ統合する。
- Gen3 の長さ 12 テーブルを接続する。
- view-space depth と安定 partition を実装する。
- range 指定付き `drawElements` を追加する。
- フレーム中の `slice().sort()` を除去する。

### Phase 3: 世代別半透明

対象:

- `packages/engine/src/render/gl/state.ts`
- `packages/engine/src/render/webgl-renderer.ts`
- `packages/engine/src/render/shaders/ps1_forward.ts`
- `packages/engine/src/render/quantize/palette-sfc.ts`

作業:

- 拡張 blend state と resolver を接続する。
- Gen2、Gen3、Gen4 のモードを実装する。
- 半透明時の depth write、fog、cull の復元を state cache で保証する。
- 旧 `blendMode` を互換変換する。

### Phase 4: Gen3、Gen4 SpriteCommand

対象:

- `packages/engine/src/render/generation-pipeline.ts`
- `packages/engine/src/render/webgl-renderer.ts`
- `packages/engine/src/render/geometry.ts`
- 必要に応じて新規 sprite shader

作業:

- profile に基づく sprite routing を実装する。
- cylindrical/spherical billboard を実装する。
- Gen3 sprite を OT へ統合する。
- Gen4 sprite の depth test/write を実装する。
- screen-space sprite を world 後に描く。

### Phase 5: アプリ移行と QA

対象:

- `apps/console-chaos/src/render/material.ts`
- `apps/console-chaos/src/presentation/frame.ts`
- `apps/racing/src/presentation/**`
- `packages/engine/README.md`
- `Docs/ENGINE_API.md`

作業:

- Console Chaos の半透明材質を世代別モードへ移行する。
- Gen3、Gen4 SpriteCommand の最小実利用例を追加する。
- 既存のゲームデザイン、当たり判定、可視条件は変更しない。
- 公開 API と slot の使用例を文書化する。

## 9. テスト計画

### 9.1 単体テスト

- profile が四世代の異なる translucent capability を返す。
- Gen2 の加算、減算、1/2、固定色を既知 RGB 値で検証する。
- Gen3 の四モードを既知 RGB 値で検証する。
- Gen4 プリセットを CPU 参照式で検証する。
- Gen1 で半透明コマンドが Alpha 合成されない。
- OT が必ず 12 リストを持ち、0 から 11 の順で走査される。
- 不正な index/range が検証エラーになる。
- 同一深度の投入順が安定する。
- triangle partition 後も全 index が重複・欠落なく一度ずつ現れる。
- workspace と output buffer がフレーム間で再利用される。
- fake GL が blend equation/factor/constant の正しい呼び出し列を記録する。
- billboard 行列がカメラ移動に対して正対を維持する。

### 9.2 統合テスト

最小の合成確認シーンを用意する。

- 不透明背景
- 不透明な前景
- 各世代モードの半透明板
- world-space sprite
- screen-space sprite

ブラウザ上で代表ピクセルを読み、CPU 参照値との許容誤差内であることを確認する。
Gen3 では UI sprite がすべての world packet より後に描かれることも確認する。

### 9.3 回帰テスト

- Console Chaos の unit、golden、replay、E2E。
- Racing の unit、E2E、performance proof。
- Gen1、Gen2 の sprite plane と量子化結果。
- 12 方向の世代切替と transition 中の二世代描画。
- 起動後に framebuffer、shader、ordering workspace を追加確保しないこと。

### 9.4 性能テスト

`apps/console-chaos/tools/bench-sort.ts` に OT12 partition を追加し、次を同じ入力で比較する。

- naive comparator sort
- 現行 radix sort
- OT12 stable partition

受け入れ基準:

- 20,000 三角形で p95 2.0 ms 以内。
- 現行 radix sort より p95 を悪化させない。
- ソート中の毎フレーム heap allocation がない。
- 通常フレームの描画世代数と三角形予算を既存 performance proof 内に保つ。

## 10. 完了条件

- Gen2、Gen3、Gen4 が同一の加算合成ではなく、各世代の指定モードで描かれる。
- Gen3 が長さ 12 のリスト配列を持ち、index 0 から順に描画する。
- 3D、半透明、screen-space UI、デバッグの描画順が slot 契約で保証される。
- Gen3 の半透明が既に描かれた framebuffer color を参照して合成される。
- polygon sort の範囲が OT slot 内に限定され、全体比較ソートがなくなる。
- Gen3、Gen4 で world-space と screen-space の `SpriteCommand` が表示される。
- Gen4 の world sprite が深度テストへ参加する。
- Gen1、Gen2 の既存 sprite plane、色量子化、走査線制限に回帰がない。
- 世代切替中を含め、フレーム中の新規 shader/FBO/workspace 確保がない。
- `npm run verify` が合格する。
- 実装結果、計測値、代表画像が `Docs/measurements/` に記録される。

## 11. リスクと対策

| リスク | 対策 |
|---|---|
| `layer` と OT index の意味が衝突する | `layer` は旧経路用、OT は Gen3 専用として自動変換しない |
| 12 段量子化で近いポリゴンが同じ slot に入る | 安定順序を保証し、必要な物だけ明示 slot/range を設定する |
| Gen2 の量子化位置で既存色が変わる | CPU 参照と既存画面を先に固定し、半透明パスだけ段階導入する |
| 半透明と fog の二重適用 | blend packet 描画中の uniform/state を明示し、終了時に復元する |
| Gen4 の任意 GS 式まで広げて実装が肥大化する | 今回は代表プリセットに限定し、任意 selector は実需要が出た時だけ追加する |
| Gen3/4 sprite が既存モデルと前後反転する | Gen3 は OT、Gen4 は depth test、screen-space は専用後段で分離する |
| `webgl-renderer.ts` がさらに巨大化する | blend resolver、ordering table、sprite pass を別ファイルへ分離する |

## 12. 参照資料

- Nintendo, *SNES Development Manual Book I*, Color Addition/Subtraction
- Sony Computer Entertainment, *PlayStation Run-Time Library Overview*, Semi-Transparency Rates
- Sony Computer Entertainment, *GS User's Manual Version 6.0*, Alpha Blending
- `apps/console-chaos/Docs/measurements/T0-09_ps1_triangle_sort.md`
- `apps/console-chaos/Docs/measurements/T1-25_translucent.md`
- `apps/console-chaos/Docs/measurements/T2-10_sprite_plane.md`
- `apps/console-chaos/Docs/measurements/T2-11_hero_gen2_sprite.md`

