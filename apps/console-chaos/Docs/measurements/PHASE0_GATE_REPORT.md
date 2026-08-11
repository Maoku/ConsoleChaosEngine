# フェーズ 0（技術検証）完了報告とゲート判定

| 項目 | 値 |
|---|---|
| 日付 | 2026-08-01 |
| 対象 | IMPLEMENTATION_PLAN §8.1 の T0-01 〜 T0-20（全 20 タスク） |
| 環境 | Apple Silicon Mac / Node.js 22 / 埋め込み Chromium（WebGL2） |

## 1. タスクの完了状況

| ID | タスク | 状態 | 主な成果物 |
|---|---|---|---|
| T0-01 | リポジトリ初期化 | 完了 | Vite + TS strict + Vitest + ESLint + CI、`npm run verify` |
| T0-02 | ディレクトリ骨格 | 完了 | §3 のツリー、依存方向の ESLint 検査 |
| T0-03 | 固定タイムステップ | 完了 | `core/loop.ts`、10 ケースの単体テスト |
| T0-04 | WebGL2 ラッパー | 完了 | `render/gl/`（627 / 1500 行） |
| T0-05 | フルスクリーンパス列 | 完了 | `postfx/chain.ts` |
| T0-06 | glTF サブセットローダ | 完了 | `render/loader/gltf.ts`。**Blender 5.1.2 の実出力**で表示とボーンアニメを確認 |
| T0-07 | アセット規則 + 検査 | 完了 | `Docs/asset-rules.md`、`tools/gltf-preflight.ts` |
| T0-08 | V1/V2 頂点量子化 + アフィン UV | 完了 | `shaders/ps1_vertex.glsl` ほか |
| T0-09 | V3 三角形ソート + 計測 | 完了 | `render/sort.ts`、**ポリゴン予算を決定** |
| T0-10 | V4 FC カラークラッシュ | 完了 | 2 パス方式、**候補 A 不要と決定** |
| T0-11 | V6 CRT プリセット | 完了 | 1 本のシェーダ + 4 プリセット + 品質 2 バリアント |
| T0-12 | V7 世代切替 | 完了 | `render/pipeline.ts` |
| T0-13 | SFC RGB555 量子化 | 完了 | `quantize/palette_sfc.ts` |
| T0-14 | 投影ルール | 完了 | `gameplay/projection.ts`、テストファースト 15 ケース |
| T0-15 | 体感確認用ミニレベル | 完了 | `debug/mini_level.ts`（G0-1 の判定待ち） |
| T0-16 | V5 走査線スプライト制限 | 完了 | `render/sprite_limit.ts`、1 ティック遅延込み |
| T0-17 | FC 音源合成 | 完了 | `audio/synth_fc.ts`、波形を実測 |
| T0-18 | BGM 位相同期 | 完了（一部未了） | `audio/clock.ts` / `engine.ts`。**4 ブラウザ確認は未了** |
| T0-19 | FC 量子化表示の初期確認 | 完了 | 所見を記録（§16.1-d への入力） |
| T0-20 | README + 商標チェック | 完了 | GAME_PLAN §7.1.1 の 4 項目を記載 |

テスト 111 件、`npm run verify`（lint / test / 行数 / レベル / 商標 / アセット / build）が通過。

## 2. ゲート判定（§8.1 / §9.2）

| # | ゲート | 判定 | 根拠 |
|---|---|---|---|
| G0-1 | 投影ルールが「直感的に理解できる」か | **通過**（2026-08-01） | 試遊による判定。実施と判定は開発者が行い「評価 OK」と報告（[G0-1 試遊キット](G0-1_playtest_kit.md) §5）。**試遊者ごとの記録は残っていない**ため、細目は T1-20 の外部プレイテストで改めて採る |
| G0-2 | GL ラッパーが 1,500 行以内か | **通過** | 627 行（`npm run check:budget` が CI で検査） |
| G0-3 | PS1 のポリゴン予算が現実的か | **通過** | 基数ソートで 2.0ms あたり 146,761 三角形。予算 20,000 に対し十分な余裕（[T0-09 の記録](T0-09_ps1_triangle_sort.md)） |

**G0-1 はフェーズ 0 の本命であり、人にしか判定できない。**
2026-08-01 に試遊で通過。3 ゲートすべてが通過し、
フェーズ 1（垂直スライス）は「前倒し」ではなく正式な着手になった。

## 3. 本フェーズで確定した決定事項

| 論点 | 決定 | 根拠 |
|---|---|---|
| §16.1-a / §10-E PS1 ポリゴン予算 | フレームあたり **20,000 三角形** | T0-09 の計測。ソートは制約にならない |
| §16.1-b / §10-D FC カラークラッシュの方式 | **2 パス（候補 B）。1 パス（候補 A）は実装しない** | T0-10 の計測。B は 0.69ms で予算内 |
| §10-A 投影モード切替時の位置解決 | **Z アンカー方式**を実装（§5.5.3 の推奨案どおり） | T0-14 / T0-15 |
| §10-B FC の当たり判定 1 ティック遅延 | **許容する**（実装済み） | T0-16 |
| §10-C スプライト間引きの優先順位 | **登録順（OAM 順を模す）** | T0-16 |
| §16.1-c アセットの対応範囲 | `Docs/asset-rules.md` に確定 | T0-07 |

## 4. 未了・申し送り

| 項目 | 内容 | 期限 |
|---|---|---|
| ~~G0-1 の試遊~~ | **解消。** 2026-08-01 に試遊を実施し通過（[記録](G0-1_playtest_kit.md)）。試遊者ごとの細目は未記録で、T1-20 で改めて採る | 完了（2026-08-01） |
| T0-18 の 4 ブラウザ確認 | Safari / Firefox / Edge が本環境に無く未検証。`PeriodicWave` の退避経路は実装済み | T1-16 まで |
| ~~実アセットでの検証~~ | **解消。** Blender 5.1.2 の実出力（`tools/blender_export_player.py`）が無修正でローダの範囲内に収まり、4 世代の経路で表示・ボーンアニメ再生を確認 | 完了（2026-08-01） |
| ドローコール上限 | 世代ごとの上限は未決定（§6.2） | フェーズ 1 |

## 5. フェーズ 1 への引き継ぎ

フェーズ 0 の成果物のうち、**そのまま本番で使うもの**：

- `core/loop.ts` / `core/time.ts` / `core/assert.ts`
- `render/gl/` 一式、`render/postfx/`、`render/quantize/`、`render/pipeline.ts`
- `render/sort.ts`、`render/sprite_limit.ts`、`render/loader/gltf.ts`、`render/camera.ts`
- `gameplay/projection.ts`（**本作の中核**）
- `audio/score.ts` / `clock.ts` / `engine.ts` / `synth_fc.ts` / `voicelimit.ts`
- `generation/profiles.ts`（映像項目のみ。入力・音・アクションは T1-02 で追加）

**足場であり置き換えるもの**（`src/debug/` 配下）：

- `smoke_triangle` / `smoke_postfx` / `smoke_model` / `smoke_ps1` / `smoke_fc` / `smoke_switch`
- `mini_level`（物理と入力は T1-06 / T1-04 の実装に置き換える）
- `smoke_character`（プレイヤーモデルは T1-08 で作る）
