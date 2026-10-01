# Console Chaos ドキュメント案内

## 現行ドキュメント

| 文書 | 内容 |
|---|---|
| [FOUR_STAGE_DEMO_PLAN.md](FOUR_STAGE_DEMO_PLAN.md) | 初回15〜30分・4ステージ体験版の企画案（未実装） |
| [development/FOUR_STAGE_IMPLEMENTATION_PLAN.md](development/FOUR_STAGE_IMPLEMENTATION_PLAN.md) | 体験版の変更箇所・依存関係・実装タスク・受入条件（未着手） |
| [development/FOUR_STAGE_RESEARCH.md](development/FOUR_STAGE_RESEARCH.md) | 体験版企画の根拠となる現状調査・実行検証 |
| [asset-rules.md](asset-rules.md) | glTF、テクスチャ、sprite のアセット規則 |
| [VALIDATION.md](VALIDATION.md) | 技術検証、性能、回帰、人手評価の状況 |
| [PLAYTEST.md](PLAYTEST.md) | 外部プレイテストの実施・集計手順 |

`concept/`、`hero-gen-1-animations/`、`hero-gen-2-animations/` と
`console-chaos-title.png` はドキュメントではなく、再生成に使う原画・参照素材です。

## 開発過程

企画書、実装計画、レビュー対応、グラフィックス改修計画は
[development/](development/) にまとめています。現行仕様と異なる履歴も含むため、
実装と上記の現行ドキュメントを優先してください。

## ローカル記録

`Docs/measurements/` と `Docs/archive/` は Git 管理外です。生の計測値や比較画像を保存するときは
前者を使い、公開資料には必要な結論だけを [VALIDATION.md](VALIDATION.md) へ反映します。
