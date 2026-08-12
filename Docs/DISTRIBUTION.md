# Console Chaos Engine 配布ガイド

## 配布物

`npm run verify:distribution` は次のファイルを `artifacts/` に生成します。

| ファイル                                 | 用途                                                   |
| ---------------------------------------- | ------------------------------------------------------ |
| `console-chaos-engine-0.2.0.tgz`         | ランタイム、レンダリング、入力、音声、アセット、型定義、リリースノート |
| `console-chaos-engine-testkit-0.2.0.tgz` | 任意導入の決定論的テストダブルと型定義                                 |
| `SHA256SUMS`                             | 配布後の完全性確認                                     |

tarballにはビルド済みESM、TypeScript型定義、パッケージREADMEが入り、エンジン本体には
`RELEASE_NOTES.md` も同梱されます。
アプリ、テスト、開発ツール、元のアセットは入りません。エンジンの唯一の実行時依存は
`gl-matrix` で、npmが導入時に解決します。

## 作成と検証

Node.js 22以上とnpmを使います。

```sh
npm install
npm run verify:distribution
```

この検証は次を実行します。

1. ViteでES2022の単一ESMバンドルを生成する
2. `tsc` で型定義を生成する
3. 両パッケージをnpm tarballにする
4. 一時的な別プロジェクトへtarballをオフラインでインストールする
5. Node.jsから公開APIをimportして実行する
6. `moduleResolution: NodeNext` でconsumerコードを型検査する
7. SHA-256チェックサムを生成する

完全性を手動確認する場合:

```sh
cd artifacts
shasum -a 256 -c SHA256SUMS
```

## 他プロジェクトへの導入

tarballを直接渡す場合:

```sh
npm install /absolute/path/console-chaos-engine-0.2.0.tgz
```

テストキットも使う場合は、エンジン本体と同時に導入します。

```sh
npm install /absolute/path/console-chaos-engine-0.2.0.tgz
npm install -D /absolute/path/console-chaos-engine-testkit-0.2.0.tgz
```

`package.json` に `file:` でtarballを記録する運用も可能です。チーム内で共有する場合は、
tarballを各プロジェクトから安定して参照できるアーティファクトストレージへ配置してください。

```json
{
  "dependencies": {
    "@console-chaos/engine": "file:vendor/console-chaos-engine-0.2.0.tgz"
  }
}
```

## npm互換レジストリへ公開する

公開前に、対象レジストリ、`@console-chaos` scopeの所有権、公開範囲、ライセンスを決定してください。
このリポジトリには現在ライセンスファイルがないため、生成済みtarballは許可されたプロジェクト間の
配布を前提とします。

組織のprivate registryへ公開する例:

```sh
npm publish artifacts/console-chaos-engine-0.2.0.tgz --registry https://registry.example.com
npm publish artifacts/console-chaos-engine-testkit-0.2.0.tgz --registry https://registry.example.com
```

public npmへ出す場合は、ライセンスとscope設定を完了した後で `--access public` を明示します。
エンジン本体を先に公開し、その後にテストキットを公開してください。

## バージョン管理

Semantic Versioningを使います。公開APIに互換性のない変更はmajor、後方互換の機能追加はminor、
修正はpatchを更新します。リリース時は次を同時に更新します。

- `packages/engine/package.json` の `version`
- `packages/engine/src/index.ts` の `ENGINE_VERSION`
- `packages/engine-testkit/package.json` の `version` と `peerDependencies`
- `apps/*/package.json` のworkspace内依存バージョン
- `package-lock.json`
- ドキュメント内のtarball名
- `packages/engine/RELEASE_NOTES.md`

リリース候補ではまず `npm run verify` でワークスペース全体を検証し、続けて
`npm run verify:distribution` でconsumer境界を検証してください。

## 互換性方針

- パッケージ形式: ESM only
- JavaScriptターゲット: ES2022
- 公式import経路: `@console-chaos/engine` と `@console-chaos/engine-testkit`
- `dist/` 内部へのdeep import: 非対応
- ブラウザ描画: Canvas 2DまたはWebGL 2
- テストキット: 同じminor系列のエンジンをpeer dependencyとして要求

`GameModule` と `RenderFrame` の境界を利用すると、ゲーム内容をエンジンの内部実装から分離できます。
最小構成とAPI分類は `packages/engine/README.md` を参照してください。
