# Console Chaos Engine

FC/SFC/PS1/PS2 の4つのコンソール世代表現を提供するエンジン

ゲームの状態は単一で共有、4つの世代の出力を切り替えて遊ぶなどができます。
厳密なハード制約に準拠するというよりは世代の表現を擬似体験するためのものです。

元々は、4つのコンソール世代表現を渡り歩くことで進められる謎解きアクションを作らせてみようというところからスタートし
そのゲーム実装から再利用のためのエンジン化を行ったものです。

[`Docs/development/CORE_PLAN.md`](Docs/development/CORE_PLAN.md) が起点となった指示です。

- `packages/engine`: エンジン実装
- `packages/engine-testkit`: browser API を使わない deterministic fake
- `apps/console-chaos`: 元となった謎解きアクション
- `apps/asset-pipeline-sample`: 元素材から各世代のアセットを生成するパイプラインの例

## 4世代のコンソール表現

Engineは同じゲーム状態を維持したまま、映像・音声・入力能力を4つの世代プロファイルで切り替えます。

| 世代            | 基本表現            | 映像上の特徴                                                   | 音源・入力の特徴                                |
| --------------- | ------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| 第1世代 / `FC`  | 256×224の2D         | 固定54色、走査線単位のラスタースクロール、RF信号、強い色にじみ | 5 voice PSG、4方向D-pad                         |
| 第2世代 / `SFC` | 256×224の2D・疑似3D | RGB555、アフィン平面、コンポジット信号、半透明                 | 8 voice BRR、8方向D-pad                         |
| 第3世代 / `PS1` | 320×240の3D         | 頂点量子化、アフィンテクスチャ、depthなしのポリゴンソート      | 24 voice ADPCM、2軸analog、rumble               |
| 第4世代 / `PS2` | 640×448の3D         | depth buffer、動的light、環境反射、linear filtering            | 48 voice streaming、4軸analog、pressure、rumble |

これらは特定実機を正確に再現するエミュレーターではなく、ゲーム表現へ一貫した制約を与えるための
スタイルプロファイルです。解像度、palette、sprite制限、CRT、音声、入力、世代切替の詳細は
[`packages/engine/README.md`](packages/engine/README.md#4世代のコンソール表現) を参照してください。

```sh
npm install
npm run verify
npm run dev -w @console-chaos/console-chaos
npm run dev -w @console-chaos/asset-pipeline-sample
```

## 他プロジェクトで使う

配布用tarballとSHA-256チェックサムは次のコマンドで生成します。

```sh
npm run verify:distribution
```

生成先は `artifacts/` です。エンジン本体の導入・最小構成・公開APIは
[`packages/engine/README.md`](packages/engine/README.md)、配布とリリースの詳細は
[`Docs/DISTRIBUTION.md`](Docs/DISTRIBUTION.md)、変更点は
[`packages/engine/RELEASE_NOTES.md`](packages/engine/RELEASE_NOTES.md) を参照してください。

公開ドキュメントの一覧は [`Docs/README.md`](Docs/README.md)、実装と品質検証の要約は
[`Docs/VALIDATION.md`](Docs/VALIDATION.md) にまとめています。
