# @console-chaos/engine-testkit

`@console-chaos/engine` 用の決定論的なテストダブルです。DOM、実時間、実オーディオを使わずに
ゲームモジュールとホストのライフサイクルをテストできます。

```sh
npm install -D @console-chaos/engine-testkit
```

同じリリースで生成したtarballを使う場合:

```sh
npm install -D \
  /path/to/artifacts/console-chaos-engine-0.1.0.tgz \
  /path/to/artifacts/console-chaos-engine-testkit-0.1.0.tgz
```

## 提供するテストダブル

- `createManualLoopHost`: 時刻、可視状態、フレーム実行をテストから制御
- `createRecordingRenderer`: 描画コマンド数と世代を記録
- `createMutableInputSource`: 任意の `DeviceSnapshot` を注入
- `createRecordingAudioService`: 音声要求、スコア、世代プロファイルを記録

テストキットの `0.1.x` はエンジンの `0.1.x` をpeer dependencyとして要求します。
