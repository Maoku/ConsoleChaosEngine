# Hero GEN-2 animation bundle

`hero-gen-2-concept.png` を外見・配色・衣装の基準にした、右向きサイドビューのアニメーション素材です。

| Action         | Frames | Grid | Preview timing | Runtime use           |
| -------------- | -----: | ---: | -------------: | --------------------- |
| `walk`         |      6 |  2x3 |   110 ms/frame | loop                  |
| `jump`         |      6 |  2x3 |   115 ms/frame | one-shot              |
| `hand-forward` |      4 |  2x2 |   140 ms/frame | one-shot / final hold |

各アクションフォルダには、生成原画 `raw-sheet.png`、マゼンタ除去版 `raw-sheet-clean.png`、透過スプライトシート `sheet-transparent.png`、連番フレーム、透過プレビュー `animation.gif`、生成プロンプト、QC情報 `pipeline-meta.json` が入っています。

フレーム順は左上から右方向へ読み、次の行へ続きます。出力セルはすべて 256x256 px です。歩行と右手動作は足元基準で揃え、ジャンプは空中姿勢を保つ中央基準です。`character-scale-profile.json` は歩行を基準とした共通スケール契約で、右手動作にも適用しています。

歩行3コマ目は生成原画の完成した靴輪郭がソースセル境界判定に触れたため、目視確認後にソース境界のみ許容して処理しています。透過出力側の境界接触、貼り付けクランプ、空フレームはありません。

スーパーファミコン表示用の32x48ピクセル候補、16x16 OBJ、4bppパターン、BGR555 OBJパレットへの変換は、`tools/exporters/gen16-sprite/`の決定論的なCLIで行います。編集対象と生成物の配置、コマンド、暫定アニメーション割当は`content/assets/hero/gen16/README.md`を参照してください。
