# Console Chaos Engine

4つのコンソール世代表現をゲーム内容から分離した TypeScript/Vite workspace です。

- `packages/engine`: 固定ティック、generation、ActionMap、RenderFrame、audio、assets、physics、scene、web host
- `packages/engine-testkit`: browser API を使わない deterministic fake
- `apps/console-chaos`: 参照ゲームの無変更取り込みを基準にした謎解きアクション
- `apps/racing`: engine 公開 API だけを使う3周のレースゲーム

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
npm run dev -w @console-chaos/racing
```

## 他プロジェクトで使う

配布用tarballとSHA-256チェックサムは次のコマンドで生成します。

```sh
npm run verify:distribution
```

生成先は `artifacts/` です。エンジン本体の導入・最小構成・公開APIは
[`packages/engine/README.md`](packages/engine/README.md)、配布とリリースの詳細は
[`Docs/DISTRIBUTION.md`](Docs/DISTRIBUTION.md) を参照してください。

参照元 `../Opus5ConsoleChaos` は読み取り専用です。基準 commit と531ファイルの SHA-256 は
`Docs/REFERENCE_SNAPSHOT.json` に記録しています。
