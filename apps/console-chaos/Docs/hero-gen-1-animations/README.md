# Hero GEN-1 animation bundle

`hero-gen-1-concept.png` を外見・配色・衣装の基準にした、右向きサイドビューのアニメーション素材です。

| Action         | Frames | Grid | Preview timing | Runtime use           |
| -------------- | -----: | ---: | -------------: | --------------------- |
| `walk`         |      6 |  2x3 |   110 ms/frame | loop                  |
| `jump`         |      6 |  2x3 |   115 ms/frame | one-shot              |
| `hand-forward` |      4 |  2x2 |   140 ms/frame | one-shot / final hold |

各アクションフォルダには、生成原画 `raw-sheet.png`、マゼンタ除去版 `raw-sheet-clean.png`、透過スプライトシート `sheet-transparent.png`、連番フレーム、透過プレビュー `animation.gif`、生成プロンプト、QC情報 `pipeline-meta.json` が入っています。

フレーム順は左上から右方向へ読み、次の行へ続きます。出力セルはすべて 256x256 px です。接地動作は足元基準で揃え、`character-scale-profile.json` に歩行を基準とした共通スケール契約を保存しています。

## GEN-8変換

ファミコン表示用の16x32ピクセル候補、8x16 OBJ、2bpp CHR、局所3色パレットへの変換は、`tools/exporters/gen8-sprite/`の決定論的なCLIで行います。編集対象と生成物の配置、コマンド、暫定アニメーション割当は`content/assets/hero/gen8/README.md`を参照してください。

立ち系の`idle`、`walk`、`attack`、`shift`はIdleフレームの表示身長へ固定します。ジャンプなどはアクション内で共通スケールを使い、フレームごとの自動ズームを行いません。
