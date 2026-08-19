# 検証結果

この文書は公開に必要な結論だけをまとめたものです。ベンチマークの全サンプル、比較画像、
一時的な作業ログは Git 管理外に置き、ここからは参照しません。

## 移行の忠実性

2026-08-11 に、旧アプリ実装から再利用可能な Engine への完全移行を検証しました。

- 決定的リプレイは 10/10 件で位置、速度、世代、解決状態、チェックポイント、tick、seed が一致
- F-1 / F-2 / S-1 / P1-1 / P1-2 / P2-1 の6パズルで成立世代と通しリプレイが一致
- 4世代、PS1→PS2 切替50%、6パズルの計11描画 command capture が完全一致
- 48 kHz stereo、4世代×14.4秒の PCM で peak、RMS、fingerprint が一致し、0.25秒の無音窓は0件
- ゲーム内容、レベル、アセット、操作、HUD、音楽構造に意図的な差分はなく、変更は所有境界と公開 API 化のみ

描画 command と PCM の golden は
`apps/console-chaos/tests/fixtures/` に置き、通常のテストで継続検査します。旧実装の531ファイルを
固定した immutable snapshot は `tools/fixtures/reference-snapshot.json` に保持しています。

## 性能

2026-08-12、Apple silicon / macOS 26.5.2 / Node.js 26 の環境で、20,000三角形を
warm-up 20回、計測60回で比較しました。

| 実装 | median | p95 | 2.0 ms 予算 |
|---|---:|---:|---:|
| comparator sort | 5.206 ms | 7.408 ms | 不合格 |
| radix sort | 0.229 ms | 0.622 ms | 合格 |
| OT12 stable partition | 0.187 ms | 0.598 ms | 合格 |

OT12 は p95 で radix sort より0.024 ms短く、20,000三角形の予算を満たしました。
通常描画は1世代、切替中だけ2世代を描画し、4世代分の post-effect target は起動時に確保するため、
切替中の shader compile や作業領域の再確保はありません。

## ライフサイクルと復旧

- boot→2 frame→dispose を10回繰り返し、module / input / audio / renderer は各10回だけ解放
- 各 cycle 後の world entity と active asset は0。二重 dispose による追加処理なし
- active GPU resource を保った context restore を10回行い、active 1 / GPU 1を維持。最終 release 後は0
- context lost の既定動作抑止、restore 通知、unsubscribe、dispose 後の listener 無効化を検査

## 回帰検査

2026-08-19 の現行変更確認では、Engine 46件、Engine testkit 1件、asset pipeline 25件、
asset pipeline sample 20件、Console Chaos 415件、Console E2E 2件のテストが合格しました。
境界・移行・容量・レベル・アセット・商標・snapshot 検査と各 production build も合格しています。
実ブラウザの WebGL 2 では4世代の半透明、world/screen sprite、描画順を確認し、
console warning / error は0件でした。

現在の変更に対する正本は、リポジトリルートの次のコマンドです。

```sh
npm run verify
```

ゲーム固有の検証結果と未実施の人手評価は
[Console Chaos の検証結果](../apps/console-chaos/Docs/VALIDATION.md) に分離しています。
