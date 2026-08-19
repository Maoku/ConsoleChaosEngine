# ドキュメント案内

公開時に参照する文書と、開発過程の記録を分けています。

## 公開ドキュメント

| 文書 | 内容 |
|---|---|
| [ENGINE_API.md](ENGINE_API.md) | エンジンの公開 API と最小構成 |
| [DISTRIBUTION.md](DISTRIBUTION.md) | 配布物の作成、検証、公開手順 |
| [VALIDATION.md](VALIDATION.md) | 移行、性能、回帰、ライフサイクル検証の要約 |
| [../packages/engine/README.md](../packages/engine/README.md) | 導入方法と世代プロファイルの仕様 |
| [../packages/engine/RELEASE_NOTES.md](../packages/engine/RELEASE_NOTES.md) | リリースごとの変更点 |

## 開発過程

計画書、設計判断、移行報告は [development/](development/) にまとめています。
現行仕様の正本ではありませんが、判断の背景を追うための記録として保持します。

## ローカル記録

次のディレクトリは `.gitignore` の対象です。

- `Docs/measurements/`: ベンチマーク出力、画面キャプチャなどの再生成可能な生データ
- `Docs/archive/`: 採用しなかった案、役目を終えた資料、公開不要な作業記録の退避先

公開文書はこれらへリンクせず、必要な結論を本文へ記載します。テストが必要とする golden や
baseline はドキュメントではないため、対応する `tests/fixtures/` または `tools/fixtures/` に置きます。
