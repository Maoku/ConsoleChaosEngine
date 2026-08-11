# Console Chaos Engine

4つのコンソール世代表現をゲーム内容から分離した TypeScript/Vite workspace です。

- `packages/engine`: 固定ティック、generation、ActionMap、RenderFrame、audio、assets、physics、scene、web host
- `packages/engine-testkit`: browser API を使わない deterministic fake
- `apps/console-chaos`: 参照ゲームの無変更取り込みを基準にした謎解きアクション
- `apps/racing`: engine 公開 API だけを使う3周のレースゲーム

```sh
npm install
npm run verify
npm run dev -w @console-chaos/console-chaos
npm run dev -w @console-chaos/racing
```

参照元 `../Opus5ConsoleChaos` は読み取り専用です。基準 commit と531ファイルの SHA-256 は
`Docs/REFERENCE_SNAPSHOT.json` に記録しています。
