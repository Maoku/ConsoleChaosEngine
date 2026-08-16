# Asset Pipeline Sample

ImageGenで用意した世代非依存の3姿勢×3眼状態のキャラクター原画から、`@console-chaos/asset-pipeline` だけで `FC / SFC / PS1 / PS2` 用animation frameを生成し、Console Chaos Engine の世代別rendererと音源で同じタイトル画面・BGMを表現するサンプルです。

- FC/SFC: ImageGen由来の3姿勢を6/12 Hzで切替。runtime回転は使用しません。
- PS1/PS2: 同じkey poseに、poseへ焼き込まれた角度を差し引いた30/60 Hzのresidual Tweenを適用します。
- 全世代: ImageGen由来の3段階の目パチとポニーテール差分をpipeline変換assetで再生します。
- BGM: 120 BPMの同一曲を世代別音源で再生し、発音能力に応じて3/4/5/6 trackへ編曲します。

## 実行

リポジトリルートで次を実行します。

```sh
npm run build:asset-pipeline
npm run assets:build -w @console-chaos/asset-pipeline-sample
npm run assets:check -w @console-chaos/asset-pipeline-sample
npm run verify -w @console-chaos/asset-pipeline-sample
npm run dev -w @console-chaos/asset-pipeline-sample
```

全workspaceを含む検証は `npm run verify` です。生成済みPNGは直接編集せず、原画または `tools/art.config.mjs` を変更して `assets:build` で再生成してください。

## 操作

- `1 / 2 / 3 / 4`: `FC / SFC / PS1 / PS2` を直接選択
- `Q / E`: 前後の世代へ切替
- ゲームパッド左右shoulder: 前後の世代へ切替
- `?generation=FC|SFC|PS1|PS2`: 初期世代を指定
- `?captureTime=0.5`: 検証用にアニメーション位相を秒で固定し、描画を静止PNGへ凍結

`prefers-reduced-motion` が有効な環境では左右の揺れを停止します。
BGMは最初のpointerまたはkeyboard操作で再生可能になり、世代切替後も拍位置を維持します。

## 構成

- `art/source`: ImageGen由来のproduction原画10枚（ロゴ1＋character 9）と参照anchor。runtime bundleには含めません。
- `tools/art.config.mjs`: matte、共通crop、resample、tone、共有FC palette、alphaの世代変換定義。姿勢や目を作るwarpは含みません。
- `public/assets/generated`: pipelineだけが生成する40枚のruntime PNGと決定的manifest。
- `src`: Engine公開APIだけを利用するブラウザruntimeとタイトルScore。asset pipelineをimportしません。
- `tests` / `tools/check-assets.ts`: animation、audio、配置、lifecycle、決定性、palette／alpha契約を検査します。

詳細な設計と完成条件は [Docs/IMPLEMENTATION_PLAN.md](Docs/IMPLEMENTATION_PLAN.md)、原画の生成履歴は [Docs/ASSET_PROVENANCE.md](Docs/ASSET_PROVENANCE.md) を参照してください。

## 検証キャプチャ

4世代とも `captureTime=0.5`、1280×720の同じviewportで取得しています。この位相は右端の開眼key poseで、PS1/PS2のruntime residualは0°です。閉眼frameは `captureTime=2.9` で全世代を追加目視し、保存captureとは分離しています。

| FC | SFC |
|---|---|
| ![FC title](Docs/captures/title-fc.png) | ![SFC title](Docs/captures/title-sfc.png) |

| PS1 | PS2 |
|---|---|
| ![PS1 title](Docs/captures/title-ps1.png) | ![PS2 title](Docs/captures/title-ps2.png) |
