# @console-chaos/engine リリースノート

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
