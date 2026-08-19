# ゴール

ConsoleChaosEngine の 1つの画像から各世代の表現に準拠したアセットを作る console-chaos-asset-pipiline を用いた
サンプルアプリの提供

# 制作物

変換元となる画像は $Image Gen スキルを用いて作成
下記それぞれのシーンに対して必要な画像を用意する。この時世代別のアセットを直接を作るのは禁止
必ず console-chaos-asset-pipeline を使うこと

## タイトル画面

- ConsoleChaosEngine のタイトルロゴ
- apps/asset-pipeline-sample/Docs/character.png のキャラクターの上半身を下部中央に映す。それぞれの世代で左右に体を傾けてリズムを取るようなアニメーション
    - 第1,2世代はパターン切り替え。それぞれのコンソールハードの制限に合わせた実装をする。角度変化に見えないようにパターンはアセットで用意
    - 第3,4世代はTweenを加えた滑らかさ向上

- ポニーテール部分を揺らす
- 目パチアニメーション

- アニメーションのリズムにあった楽しそうなBGMを追加。BGMも ConsoleChaosEngineの各世代のスペックに準拠する。
