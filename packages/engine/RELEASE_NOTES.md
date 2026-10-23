# @console-chaos/engine リリースノート

## 0.3.0 — 2026-08-27

### 主な変更

- `TransformCommand.rotation` に quaternion `(x, y, z, w)` を指定できるようにし、meshとskinned meshの
  任意軸回転をWebGL描画へ反映しました。
- `CameraCommand` に垂直画角、near/far clip、up方向を追加し、Canvas/WebGL rendererで同じ投影規則を
  使用するようにしました。world座標をviewport pixelへ変換するcamera utilityも公開しています。
- ambient、directional、point lightを複数同時に解決し、point lightごとの投影shadowを描画できるように
  しました。shader上限はrenderer生成時に設定でき、GPUのuniform上限を起動時に検証します。
- box geometryに面の分割密度と最大分割数を追加し、lightingやshadowに必要な頂点密度をcommandから
  調整できるようにしました。
- 複数skinを持つglTFのjoint paletteをskin単位で処理し、mesh nodeに対応するskinを選べるようにしました。

### 修正と配布

- Windowsのdrive pathとUNC pathからglTF外部bufferを正しく解決するようにしました。
- 配布packageのbuild、pack、consumer検証に工程名、実行時間、終了codeを含む診断logを追加し、
  consumer検証失敗時は調査用の一時directoryを保持するようにしました。
- 同時配布packageは `@console-chaos/engine` 0.3.0、`@console-chaos/engine-testkit` 0.3.0、
  `@console-chaos/asset-pipeline` 0.1.1です。

### 互換性

- 追加したcommand fieldはすべて省略可能です。
- 既存のyaw指定 `rotationY` は維持され、`rotation` が指定された場合だけquaternionを優先します。
- `@console-chaos/engine-testkit` 0.3.xと `@console-chaos/asset-pipeline` 0.1.1は
  `@console-chaos/engine` 0.3.xをpeer dependencyとして要求します。

## Workspace tooling — 2026-08-16

- Node.js専用の `@console-chaos/asset-pipeline` 0.1.0を独立packageとして追加しました。
- Engine browser runtimeのdependencyとbundle境界は変更していません。

## 0.2.0 — 2026-08-12

### 主な変更

- `HardwareGenerationProfile.video` に世代別の `translucency` 能力と
  `spriteComposition` を追加しました。
- `HardwareBlendCommand` を公開し、第2世代のRGB555カラーマス、第3世代の4固定半透明モード、
  第4世代のGS風Alphaプリセットを材質とスプライトで指定できるようにしました。
- 第3世代の描画順を、view-space depthに基づく12スロットの安定オーダリングテーブルへ移行しました。
  `orderTableIndex` で固定スロットを、`polygonSortRange` で三角形単位の安定partition範囲を指定できます。
- 第3・第4世代で `SpriteCommand` をscene描画へ統合しました。world/screen空間、
  cylindrical/spherical billboard、depth write、世代別半透明を利用できます。
- Console ChaosとRacingの材質・描画順を新しい公開APIへ移行しました。

### 修正

- 第3世代でプレイヤーの位置によって床より奥へ描画されることがある問題を修正しました。
  プレイヤーを固定OTスロット9へ登録し、床の三角形partition範囲より常に後で描画します。

### 互換性

- 公開コマンドへ追加したフィールドはすべて省略可能です。
- 既存の `blendMode` は互換入力として維持され、内部でportable blendへ変換されます。
- `@console-chaos/engine-testkit` 0.2.xは `@console-chaos/engine` 0.2.xをpeer dependencyとして要求します。

### 品質と性能

- Console Chaos検証は44ファイル・413テスト、E2E、型検査、asset検査、buildを通過しました。
- 20,000三角形のOT12安定partitionはmacOS計測でmedian 0.187 ms、p95 0.598 msとなり、
  2.0 ms予算内かつ従来radix sortのp95 0.622 msを下回りました。
- 配布tarballは一時consumerへオフライン導入し、ESM import、実行時smoke、NodeNext型検査、
  SHA-256完全性を検証しています。
