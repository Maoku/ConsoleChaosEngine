# Console Chaos Engine — 実装計画書

> 本書は [ENGINE_PLAN.md](ENGINE_PLAN.md) を実装可能な粒度へ具体化する。
> 対象は、`Opus5ConsoleChaos` の現行ゲームを忠実に維持しながら再利用可能なゲームエンジンへ分離する作業である。
>
> 初版: 2026-08-11
>
> 仕様の優先順位は **`ENGINE_PLAN.md` > 本書 > 実装中の補助文書** とする。

---

## 1. 目的と完了条件

### 1.1 目的

1. 4 つのコンソール世代表現を、ゲームジャンルから独立して切り替えられるエンジンを作る。
2. `Opus5ConsoleChaos` の謎解きアクションゲームを、エンジン利用アプリとして忠実かつ完全に再現する。

### 1.2 プロジェクト全体の Definition of Done

次の条件をすべて満たした時点で完了とする。

- `Opus5ConsoleChaos` 参照元のコミット、ファイル、アセットを一度も変更していない。
- エンジンが独立パッケージとしてビルド・テストできる。
- Console Chaos アプリが、エンジンの公開 API だけを使って独立ビルドできる。
- エンジンからアプリへの import がない。
- Console Chaos の単体、ゴールデン、リプレイ、レベル、アセット検査をすべて移植し、合格している。
- Console Chaos の 4 世代表示、切替、入力、音楽位相、6 種のパズル、チェックポイント、ヒント、HUD が比較基準と一致する。
- CI で境界違反と回帰を機械的に検出できる。

### 1.3 非目標

本計画では次を作らない。

- 汎用シーンエディタ、ノードベースのエフェクトエディタ
- Unity/Unreal 相当の汎用シーングラフ、汎用物理エンジン
- WebGPU、ネイティブアプリ、モバイル専用 UI
- ネットワーク対戦、アカウント、クラウドセーブ
- npm 公開や第三者向け SDK の互換性保証
- `Opus5ConsoleChaos` のゲームデザイン変更、パズル追加、難易度調整

エンジンの抽象は、実装済みの汎用実行契約と Console Chaos が実際に必要とするものまでに限定する。

---

## 2. 制約と参照基準

### 2.1 参照元の読み取り専用運用

参照元はリポジトリルートから見て `../Opus5ConsoleChaos` とする。調査時点の基準は次のとおり。

| 項目 | 値 |
|---|---|
| 参照リポジトリ | `../Opus5ConsoleChaos` |
| 基準コミット | `628119358e720514a1f17006654f61e82cc4c207` |
| 短縮 ID | `6281193` |
| 調査時の状態 | clean |

運用ルール:

- 参照元ではファイル編集、フォーマット、依存更新、生成、ビルドを行わない。
- `npm install`、`npm run build`、アセット生成など、参照元へ書き込む可能性があるコマンドも実行しない。
- 最初に必要ファイルを本リポジトリへ複製し、以後の変換と検証は複製側だけで行う。
- 取り込み時に `tools/fixtures/reference-snapshot.json` を生成し、基準コミット、相対パス、サイズ、SHA-256 を記録する。
- 各フェーズの前後で参照元の `HEAD` と `git status --porcelain` を確認する。
- CI は参照元の存在を前提にしない。取り込み済みファイルだけで完結させる。

### 2.2 現行実装の事実

現行コードには `core/`、`generation/`、`render/`、`audio/`、`input/`、`gameplay/` などのディレクトリ分割がある。
ただし、再利用可能なパッケージ境界にはなっておらず、次の結合が残っている。

| 現行箇所 | 状態 | 分離時の課題 |
|---|---|---|
| `src/generation/profiles.ts` | 約 700 行。映像・音・入力制約に加え、主人公、カメラ、アクション、背景、アセット名を保持 | ハードウェア世代プロファイルとゲーム固有テーマへ分割する |
| `src/render/frame.ts` | 主人公、松明、回転面、背景を固定フィールドとして保持 | 平坦な汎用描画コマンドへ置き換える |
| `src/render/renderer3d.ts` | 約 950 行。モデル、スプライト、背景、影、ギミック表現を集中実装 | 機能別レンダラへ分割し、ゲーム固有アセットを外へ出す |
| `src/render/loader/gltf.ts` | 約 670 行 | エンジンのアセット層へ移し、公開範囲を限定する |
| `src/gameplay/session.ts` | ループ、入力、世代、プレイヤー、物理、パズル、ヒント、復帰を一括構成 | エンジンホストと Console Chaos セッションへ分離する |
| `src/input/mapper.ts` | 移動、ジャンプ、攻撃、世代切替を固定の `InputSnapshot` に持つ | ゲーム定義の Action Map にする |
| `src/level/schema.ts` | パズル、チェックポイント、spawn を同一スキーマに固定 | 共通シーン要素とゲーム固有メタデータを分ける |
| `src/render/material.ts` | Console Chaos の entity type とテクスチャを直接対応 | アプリ側のテーマ/素材定義へ移す |
| `src/main.ts` | 本編、検証シーン、デバッグ UI、音声起動を直接組み立て | Web ホストとアプリの bootstrap を分ける |

一方、次は抽出候補として比較的独立している。

- 固定タイムステップ、イベント、決定的乱数、軽量 ECS
- WebGL2 の薄いラッパー、FBO、ポストエフェクトチェーン
- 世代切替とトランジション状態機械
- キーボード/ゲームパッドの入力ソース
- 音楽クロック、発音数制限、世代別音源
- AABB、glTF サブセットローダ、量子化、CRT、三角形ソート

既存テストは約 7,600 行あり、単体、ゴールデン、リプレイを含む。これを捨てず、移行の安全網にする。

### 2.3 移行方針

移行は一括書き換えではなく、次の順で行う。

1. 現行実装を本リポジトリ内へそのまま取り込み、比較基準を固定する。
2. 公開 API と互換アダプタを先に作る。
3. モジュールを一つずつエンジン側へ移し、各移動後に Console Chaos の回帰検証を行う。
4. Console Chaos が公開 API だけで動く状態にする。
5. 実利用のある汎用機能だけをエンジンへ残し、互換アダプタを削除する。

---

## 3. 目標リポジトリ構成

```text
/
  package.json                 # npm workspaces、全体コマンド
  package-lock.json
  tsconfig.base.json
  eslint.config.js
  vite.config.shared.ts

  Docs/
    development/
      ENGINE_PLAN.md
      IMPLEMENTATION_PLAN.md   # 本書
  tools/fixtures/
    reference-snapshot.json    # 参照元の基準コミットとファイルハッシュ
    PARITY_MATRIX.md           # 現行ゲームの比較項目と結果
    ENGINE_API.md              # 公開 API と利用例

  packages/
    engine/
      package.json             # @console-chaos/engine
      src/
        index.ts               # 利用可能な公開 API の唯一の入口
        core/                  # loop、time、events、rng、ecs
        runtime/               # GameHost、サービス構成、lifecycle
        generation/            # 4 世代プロファイル、切替、variant
        input/                 # デバイス入力、bindings、action map
        render/                # WebGL2、描画コマンド、世代別 pipeline
        audio/                 # clock、director、source、voice limit
        assets/                # fetch、image、glTF、resource lifetime
        physics/               # AABB、query、kinematic helpers
        platform/web/          # canvas、visibility、audio unlock、resize
        debug/                 # profiler、統計。ゲーム内容は知らない
      tests/

    engine-testkit/
      package.json             # @console-chaos/engine-testkit
      src/                     # fake GL/audio、固定 host、replay helper

  apps/
    console-chaos/
      package.json
      index.html
      src/
        app.ts                 # Console Chaos の GameModule
        bootstrap.ts
        config/                # 世代別 camera/action/art/player theme
        content/               # level、material、music、asset catalog
        gameplay/              # player、projection、checkpoint、puzzles
        presentation/          # Frame 構築、Console Chaos 固有演出
        ui/                    # HUD、ヒント、開始/終了画面
        debug/                 # パズル用検証シーン、playtest logger
      public/assets/
      tests/

  tools/
    check-boundaries.ts
    check-reference-snapshot.ts
    check-assets.ts
    capture-parity.ts
```

### 3.1 パッケージ境界

```text
apps/console-chaos ────> @console-chaos/engine

@console-chaos/engine-testkit ──> @console-chaos/engine
```

禁止する依存:

- `packages/engine/**` から `apps/**` への import
- 各アプリから `@console-chaos/engine/src/**` への deep import
- エンジンの `core/` から browser API、render、audio、gameplay への依存
- エンジン内に `puzzle`、`torch`、`hero` など特定ゲームの概念を持ち込むこと

`package.json` の `exports`、TypeScript project references、ESLint、`tools/check-boundaries.ts` の四重で検査する。

---

## 4. 目標アーキテクチャ

### 4.1 エンジンホスト

エンジンはゲームジャンルを知らず、ゲームから次の lifecycle を受け取る。

```ts
export interface GameModule {
  readonly id: string;
  create(context: GameContext): Promise<GameInstance>;
}

export interface GameInstance {
  fixedUpdate(frame: FixedUpdateFrame): void;
  buildRenderFrame(frame: RenderFrame, alpha: number): void;
  dispose(): void;
}
```

`GameContext` が提供するのは `events`、`rng`、`generation`、`input`、`assets`、`audio`、`world` とする。
レベル、登場物、パズルなどの作品固有コンテンツは提供しない。

`GameHost` の責務:

1. Web プラットフォーム初期化
2. 60 Hz 固定ティック
3. 入力サンプリング
4. 世代切替状態の更新
5. `GameInstance.fixedUpdate`
6. `GameInstance.buildRenderFrame`
7. 世代別レンダリング、ポストエフェクト、表示
8. 音声とリソースの lifecycle 管理

### 4.2 世代プロファイルの分割

現行の `GenerationProfile` を次の二層に分ける。

#### エンジン所有: `HardwareGenerationProfile`

- 内部解像度、信号方式、パレット、スプライト制限
- 正射影/透視投影、深度、アフィン UV、頂点量子化、動的ライト
- テクスチャフィルタ、アニメーション更新レート
- 発音数、音源方式、サンプルレート、定位
- デジタル/アナログ、軸数、感圧、振動

#### アプリ所有: `GameGenerationTheme`

- 表示名
- カメラリグ
- ゲームアクションの差
- ゲーム内エンティティのモデル/スプライト
- 背景、マテリアル、テクスチャセット
- ゲーム固有の SFX/楽曲アレンジ

ゲーム側の世代差は `Record<GenerationId, T>` と `GenerationVariant<T>` で宣言し、世代 ID の散在した分岐を避ける。

移行初期は `LegacyGenerationProfileAdapter` で現行形へ合成し、Console Chaos の利用箇所を一つずつ新構造へ移す。

### 4.3 入力

エンジンは「jump」「attack」「accelerate」などの意味を固定しない。

```ts
const gameActions = defineActions({
  move: 'axis2d',
  use: 'button',
  switchPrevious: 'button',
  switchNext: 'button',
});
```

入力は三段階に分ける。

1. `DeviceSnapshot`: keyboard/gamepad の正規化された物理状態
2. `ActionMap<T>`: ゲーム定義の binding
3. `GenerationInputPolicy`: 4 方向化、デッドゾーン、感圧、微入力などの世代制約

Console Chaos は `move/jump/attack/switch` を定義する。
入力バッファとコヨーテタイムは、汎用の button buffer としてエンジンへ置き、適用判断はゲーム側で行う。

### 4.4 描画

汎用シーングラフは作らず、毎フレーム再利用する平坦なコマンドバッファを公開する。

```ts
export interface RenderFrame {
  camera: CameraCommand;
  meshes: MeshCommand[];
  sprites: SpriteCommand[];
  lights: LightCommand[];
  backgrounds: BackgroundCommand[];
  overlays: OverlayCommand[];
  reset(): void;
}
```

これにより現行の固定フィールドを次のように移す。

| 現行フィールド | 新しい表現 |
|---|---|
| `Frame.player` | `MeshCommand` または `SpriteCommand` |
| `Frame.torch` | `PointLightCommand` |
| `Frame.plane` | `MeshCommand` + affine-plane material |
| `Frame.backdrop` | `BackgroundCommand[]` |
| `Frame.drawables` | `MeshCommand[]` / `SpriteCommand[]` |

レンダラは以下へ分割する。

- `world-pass`: 通常メッシュ
- `sprite-pass`: スプライト/ビルボード
- `background-pass`: 背景色と最大 2 層の背景
- `shadow-pass`: 世代プロファイルが許可するときだけ実行
- `generation-pass`: 量子化、スプライト制限、頂点量子化、アフィン UV、三角形ソート
- `postfx-pass`: CRT と切替合成

パス追加用の任意プラグイン機構は作らない。実利用で必要になるまで固定パス列を維持する。

### 4.5 物理と投影

エンジンは AABB、sweep、spatial query、kinematic body の小さな部品を提供する。

重要な方針として、**2D 世代で Z 衝突を潰すルールをエンジン全体へ強制しない**。

- Console Chaos は `CollapsedDepthCollisionPolicy` を選び、現行の 2D/3D パズルを再現する。

現行の 2D→3D 吸着、安全座標、チェックポイント復帰は Console Chaos 側に残す。
これにより、世代表現と特定パズルのルールを混同しない。

### 4.6 レベルとコンテンツ

エンジンが所有する共通型は次に限定する。

- `Transform`
- renderable/collider の参照
- asset handle
- sector と可視範囲
- 汎用 entity id と tags

ゲーム固有データは各アプリが検証する。

- Console Chaos: puzzles、checkpoints、spawn、hint metadata

既存 JSON は一度に変更せず、`ConsoleChaosLevelAdapter` を介して新しい共通 scene へ読み込む。

### 4.7 オーディオ

エンジンへ移すもの:

- `AudioContext`/unlock 管理
- 世代間で位相を維持する music clock
- score の基本型
- voice allocator
- 4 世代の音源/品質変換
- SFX 再生 API

アプリに残すもの:

- 曲データ、選曲、トラック構成
- SFX ID とゲームイベントの対応
- Console Chaos のパズル音

切替時に音楽位相がずれないことは contract test にする。

### 4.8 リソースの所有権

- `GameHost` が WebGL/Audio のルートリソースを所有する。
- `AssetManager` は URL ごとの参照カウントとロード中 Promise を一元管理する。
- `GameInstance.dispose()` 後にアプリ固有リソースが解放される。
- 世代切替中にシェーダコンパイル、FBO 作成、glTF fetch を行わない。
- 4 世代で共有できる geometry と animation は共有し、texture/material variant だけを差し替える。

---

## 5. 現行モジュールの移行先

| 参照元 | 目標 | 方針 |
|---|---|---|
| `src/core/**` | `packages/engine/src/core/**` | 原則そのまま移し、browser 依存なしを維持 |
| `src/generation/switcher.ts`, `transition.ts` | `packages/engine/src/generation/**` | GameHost の service にする |
| `src/generation/profiles.ts` | engine の hardware profile + Console Chaos の theme | 互換アダプタを挟んで段階分割 |
| `src/input/source_*` | `packages/engine/src/input/device/**` | ほぼ移植 |
| `src/input/mapper.ts`, `constraints.ts` | engine action map/policy + 各アプリ bindings | 固定アクションを除去 |
| `src/render/gl/**` | `packages/engine/src/render/gl/**` | 薄いラッパーの方針を維持 |
| `src/render/postfx/**`, `quantize/**`, `sort.ts`, `sprite_limit.ts` | engine generation/render | 世代表現として抽出 |
| `src/render/loader/gltf.ts` | `packages/engine/src/assets/gltf/**` | resource lifetime を追加 |
| `src/render/frame.ts` | engine の `RenderFrame` | 互換 frame adapter 経由で移行 |
| `src/render/renderer3d.ts` | engine の複数 render pass | 挙動を変えずに分割してから抽出 |
| `src/render/material.ts`, `key_palette.ts` | Console Chaos config/content | 汎用アルゴリズムだけ engine へ残す |
| `src/audio/engine.ts`, `clock.ts`, source 群, `voicelimit.ts` | engine audio | score 内容はアプリへ移す |
| `src/audio/music.ts`, `songs.ts` | Console Chaos content | score 内容を app 所有にする |
| `src/gameplay/physics.ts` | engine physics + Console Chaos policy | AABB/sweep とゲームルールを分離 |
| `src/gameplay/projection.ts` | Console Chaos gameplay | 汎用 AABB 型だけ engine を使用 |
| `src/gameplay/player.ts`, `checkpoint.ts`, `hints.ts`, `puzzles/**` | Console Chaos gameplay | エンジンへ持ち込まない |
| `src/gameplay/session.ts`, `scene.ts` | Console Chaos `GameModule` | Host lifecycle へ接続 |
| `src/level/**` | engine scene 基本型 + Console Chaos adapter/schema | puzzle/checkpoint をアプリ所有にする |
| `src/ui/**` | Console Chaos UI | 表示設定の低レベル型だけ engine へ移す |
| `src/debug/smoke_*`, `mini_level.ts` | Console Chaos debug | engine debug には統計だけを置く |
| `src/debug/profiler.ts`, `overlay.ts` | engine debug | 実装を完成させ、ゲーム非依存にする |
| `src/main.ts` | 各 app の `bootstrap.ts` + engine Web host | scene query の分岐をアプリ側へ移す |

---

## 6. 実装フェーズと WBS

各フェーズは前フェーズの品質ゲートを通過してから着手する。失敗した場合、次フェーズでまとめて直さず、その場で回帰を解消する。

### Phase 0 — 参照基準の固定と無変更取り込み

| ID | 作業 | 成果物 | 受け入れ条件 |
|---|---|---|---|
| P0-01 | 参照元の SHA と clean 状態を記録 | `tools/fixtures/reference-snapshot.json` | SHA が `6281193`、全対象ファイルに hash がある |
| P0-02 | 現行コード、テスト、必要アセット、設定を `apps/console-chaos` へ複製 | 初期 Console Chaos workspace | 参照元に変更がなく、複製側だけで起動できる |
| P0-03 | 既存 `npm run verify` 相当を root command 化 | `verify:console-baseline` | lint/test/check/build が本リポジトリ内で成功 |
| P0-04 | 既存 replay から state hash を生成 | replay golden | 位置、速度、世代、解決済み puzzle、checkpoint、tick、seed が固定 |
| P0-05 | 4 世代、切替途中、6 パズルの基準画像を複製側から取得 | parity captures | URL、入力列、viewport、時刻、seed を記録 |
| P0-06 | OfflineAudioContext で世代別 PCM/位相基準を取得 | audio golden | 世代切替前後の bar position が一致 |

**Gate G0:** 参照元が無変更で、複製した現行ゲームが現行テストに合格する。

### Phase 1 — Workspace と境界の設置

| ID | 作業 | 成果物 | 受け入れ条件 |
|---|---|---|---|
| P1-01 | npm workspaces と TypeScript project references を作成 | root/package 構成 | engine、console app、testkit を別々に typecheck できる |
| P1-02 | `@console-chaos/engine` の公開 entry を作成 | `packages/engine/src/index.ts` | package 外から internal path を import できない |
| P1-03 | import 境界検査を追加 | `check-boundaries.ts` | 意図的な違反 fixture で CI が失敗する |
| P1-04 | fake GL/audio/loop host を testkit へ移す | `engine-testkit` | runtime dependency に test code が混ざらない |
| P1-05 | `GameModule`、`GameInstance`、`GameHost` の最小 lifecycle を作る | engine runtime | 空のテストゲームが fixed update/render/dispose できる |

**Gate G1:** パッケージ境界が機械検査され、Console Chaos の挙動はまだ変わっていない。

### Phase 2 — Core、世代切替、入力の抽出

| ID | 作業 | 成果物 | 受け入れ条件 |
|---|---|---|---|
| P2-01 | loop、time、events、rng、ECS を engine へ移す | `engine/core` | 全既存 unit test が移植され、DOM なしで実行できる |
| P2-02 | switcher/transition を engine service 化 | `engine/generation` | 連打、後勝ち、強制切替、無敵、350/600ms が一致 |
| P2-03 | hardware profile と game theme を分割 | profile + legacy adapter | 現行 `PROFILES` と合成結果が deep equal |
| P2-04 | DeviceSnapshot と generic ActionMap を実装 | `engine/input` | keyboard/gamepad の既存入力テストが維持される |
| P2-05 | Console Chaos bindings/policy を移植 | console config | 4方向、斜め、感圧、切替操作が replay hash と一致 |
| P2-06 | visibility/pause/resize を Web host へ移す | `platform/web` | hidden 復帰時に catch-up せず、既存 loop test が通る |

**Gate G2:** Console Chaos が engine の loop、generation、input を使い、全 replay の state hash が一致する。

### Phase 3 — 描画とアセットの抽出

このフェーズが最大の技術リスクである。`renderer3d.ts` を移動と同時に全面書き換えない。
先に同一パッケージ内でパスへ分割し、基準画像が一致してから engine へ移す。

| ID | 作業 | 成果物 | 受け入れ条件 |
|---|---|---|---|
| P3-01 | GL wrapper と既存 unit test を engine へ移す | `engine/render/gl` | fake GL と実 WebGL2 の双方で合格 |
| P3-02 | postfx、CRT、量子化、sort、sprite limit を移す | generation render passes | 既存 golden がピクセル一致または承認済み閾値内 |
| P3-03 | 汎用 `RenderFrame` と legacy frame adapter を作る | render command API | 現行 Frame から同じ draw call 列を生成できる |
| P3-04 | `renderer3d.ts` を world/sprite/background/shadow pass へ分割 | 分割 renderer | 分割前後で capture と draw stats が一致 |
| P3-05 | player/torch/plane/backdrop を汎用 command へ移行 | Console presentation | `frame.ts` にゲーム固有固定フィールドが残らない |
| P3-06 | glTF、texture、sprite sheet を AssetManager 配下へ移す | engine assets | 重複 fetch なし、dispose test、context lost test が通る |
| P3-07 | pipeline の事前確保と切替合成を engine 化 | generation pipeline | 切替中以外 1 世代、切替中 2 世代を描画し、切替時 allocation なし |
| P3-08 | material/art/player asset 対応を Console theme へ移す | console config/content | engine 内に Console 固有 asset path/entity type がない |

**Gate G3:** 4 世代、切替途中、6 パズルの画像差分が許容範囲内で、性能予算を悪化させない。

### Phase 4 — Audio、Physics、Scene data の抽出

| ID | 作業 | 成果物 | 受け入れ条件 |
|---|---|---|---|
| P4-01 | clock、voice limit、source、director を engine へ移す | `engine/audio` | 既存 audio/music test と PCM golden が通る |
| P4-02 | songs、music、audio cues を Console content へ移す | console audio content | engine が曲名や puzzle SFX ID を知らない |
| P4-03 | AABB/sweep/query を engine へ移す | `engine/physics` | 2D/3D の既存 physics test が adapter 経由で通る |
| P4-04 | projection switch resolution を Console policy 化 | console gameplay | 2D→3D 吸着、安全位置、落下復帰が replay と一致 |
| P4-05 | 共通 scene schema と Console level adapter を作る | engine scene + console schema | 現行 level JSON を変更せず読み込める |
| P4-06 | level/puzzle validator を分割 | root validation tools | 共通参照整合性と puzzle 世代検査がそれぞれ独立実行できる |

**Gate G4:** 音声位相、物理、投影、レベル読み込みの全テストが一致し、engine に puzzle/checkpoint 固有型がない。

### Phase 5 — Console Chaos アプリの完成と完全互換

| ID | 作業 | 成果物 | 受け入れ条件 |
|---|---|---|---|
| P5-01 | `session.ts` を `GameInstance` 実装へ分解 | console app lifecycle | tick 順序と deterministic replay が一致 |
| P5-02 | player、puzzles、hints、checkpoint、projection をアプリ配下へ確定 | console gameplay | engine への逆流がない |
| P5-03 | HUD、設定、開始/終了、playtest/debug scene をアプリへ接続 | console UI/debug | 既存 URL と操作が維持される |
| P5-04 | legacy profile/frame/input adapter を削除 | cleanup | adapter なしで全テストが通る |
| P5-05 | `PARITY_MATRIX.md` を完了 | 比較証跡 | 全項目が pass、差分は理由と承認を記録 |
| P5-06 | Console Chaos 単独配布ビルドを作る | app dist | engine package 以外の workspace source に依存しない |

**Gate G5:** `ENGINE_PLAN.md` のゴール 1 を満たし、現行ゲームが忠実かつ完全に再現される。

### Phase 6 — ハードニングと引き渡し

| ID | 作業 | 成果物 | 受け入れ条件 |
|---|---|---|---|
| P6-01 | engine public API を整理し deep import を除去 | package exports | Console app が公開 API だけで build |
| P6-02 | API と最小利用例を記述 | `ENGINE_API.md` | 新しい GameModule の作成手順を再現可能 |
| P6-03 | perf/memory/context lost を検証 | measurement report | §8 の予算内、dispose 後の増加なし |
| P6-04 | CI matrix と root verify を完成 | CI | engine/console/boundaries/assets/build が全合格 |
| P6-05 | 不要な互換コード、重複 asset、未使用 export を削除 | cleanup | Console app の capture/replay が変化しない |

**Gate G6:** 完了条件をすべて満たし、参照元の SHA と clean 状態が開始時から変わっていない。

---

## 7. テスト戦略

### 7.1 テスト階層

| 層 | 対象 | 主な検証 |
|---|---|---|
| Engine unit | core、generation、input、render、audio、assets、physics | 純粋関数、状態機械、リソース lifecycle |
| Engine contract | 公開 API と testkit | GameModule lifecycle、ActionMap、RenderFrame、Audio clock |
| Console unit | player、puzzle、projection、hints、level adapter | 現行テストの移植 |
| Console replay | area1 と各 puzzle replay | state hash の完全一致 |
| Console golden | palette、material、model、sprite、backdrop、4世代画面 | ピクセル差分 |
| Browser E2E | Console app | 起動、入力、切替、描画、音声 unlock、リスタート |
| Static checks | package/import/assets/schema | 境界違反、参照欠落、未知フィールド |

### 7.2 Console Chaos 忠実性マトリクス

`PARITY_MATRIX.md` には最低限次を記録する。

- 4 世代の内部解像度、projection、palette、depth、filter、CRT signal
- 通常切替 350 ms、強制切替 600 ms、連打キュー、切替中無敵
- 2D/3D 投影、切替時位置解決、物理、落下復帰
- キーボード/ゲームパッド、4方向、斜め、アナログ、感圧
- F-1、F-2、S-1、P1-1、P1-2、P2-1 の成立条件と解決
- sprite limit、palette crush、RGB555、affine UV、triangle sort、dynamic light
- 主人公 sprite/model と idle/walk/jump
- BGM 位相維持、voice limit、世代別 SFX
- HUD、ヒント、設定、開始/終了、playtest logging
- `area1.json` の通し replay

差分許容:

- state/replay/型/validator は完全一致を原則とする。
- 量子化、palette、sort の algorithmic golden は完全一致を原則とする。
- ブラウザ画像は GPU 差を考慮し、最大差と差分画素率の両方に閾値を設ける。
- 閾値変更は capture の更新と同じ PR では行わない。
- 意図的差分は `PARITY_MATRIX.md` に理由、影響、承認を記録するまで受け入れない。

### 7.3 提案する root command

```text
npm run lint
npm run test:engine
npm run test:console
npm run test:e2e
npm run check:boundaries
npm run check:levels
npm run check:assets
npm run check:reference
npm run build:engine
npm run build:console
npm run verify
```

`verify` は、開発者ローカルと CI で同じ順序・同じ内容を実行する。

---

## 8. 性能・容量予算

現行実装の予算を下限として維持し、抽出による明確な悪化を認めない。

| 項目 | 予算/条件 |
|---|---|
| simulation | 60 Hz 固定、catch-up 最大 5 tick |
| 通常 frame | 対象環境で 60 fps、CPU/GPU 合計 16.6 ms 未満を目標 |
| 世代切替 | 2 世代描画は 350/600 ms の期間だけ |
| shader/FBO | 起動時に 4 世代分を作成。切替中の作成禁止 |
| hot path allocation | tick、RenderFrame build、triangle sort で定常 allocation なし |
| GL wrapper | 現行の薄い設計と行数バジェットを維持 |
| asset fetch | 同一 URL の重複 fetch なし |
| memory | app dispose/再起動を 10 回行って GPU/Audio resource が単調増加しない |

計測は通常フレーム、世代切替、Console Chaos の最多描画部屋で行う。

---

## 9. リスクと対策

| リスク | 兆候 | 対策/撤退条件 |
|---|---|---|
| 抽象化しすぎる | engine API が app から直接使われない | 実利用のない extension point を削除 |
| 描画分割で見た目が変わる | golden/capture の差分増加 | 分割と機能変更を別 PR にし、legacy adapter で比較 |
| `renderer3d.ts` の全面改修が長期化 | 同時に多数の pass が壊れる | 先に同一場所で関数抽出し、1 pass ずつ移す |
| profile 分割で世代差が欠落 | Console parity は通るが一部の能力値が届かない | hardware/theme の contract test と全フィールド網羅検査 |
| 入力抽象がゲーム固有になる | ActionMap に jump/attack が現れる | action 名を型パラメータ化し、engine は value kind だけを知る |
| アセット所有が曖昧 | 切替や再起動で VRAM が増える | AssetManager の参照カウント、dispose、context-lost test |
| 参照元を誤って変更 | `git status` に差分 | 即停止し、変更内容を確認。参照元で復旧操作を勝手に行わない |

---

## 10. PR/コミット分割

推奨するマージ順は次のとおり。各 PR は一つの品質ゲートまたは一つの境界変更だけを扱う。

1. `baseline-import`: 参照スナップショットと無変更取り込み
2. `baseline-parity`: replay/image/audio の比較基準
3. `workspace-boundaries`: workspaces、exports、境界検査
4. `engine-host-core`: lifecycle、loop、events、rng、ECS
5. `engine-generation-input`: profile split、switcher、ActionMap
6. `engine-render-api`: RenderFrame と legacy adapter
7. `engine-render-passes`: GL、generation passes、renderer 分割
8. `engine-assets-audio`: AssetManager、glTF、audio
9. `engine-physics-level`: AABB、scene schema、Console adapter
10. `console-migration`: Console GameModule と UI/debug 接続
11. `console-parity-gate`: legacy adapter 削除と G5 証跡
12. `engine-hardening`: public API、性能、ドキュメント、cleanup

各 PR の必須項目:

- 対象タスク ID
- 依存境界の変更有無
- 実行した検証コマンド
- Console parity への影響
- 画像差分がある場合は before/after と理由
- 参照元の HEAD と clean 状態

---

## 11. 設計判断の保留と既定値

着手を止めないため、本計画では次を既定値とする。変更する場合は実装前に本書へ反映する。

| 項目 | 既定値 |
|---|---|
| package manager | npm workspaces。参照実装の lockfile と運用を継承 |
| engine package 名 | `@console-chaos/engine` |
| platform | TypeScript + Vite + WebGL2 + Web Audio |
| 世代 ID | 移行中は既存 `FC/SFC/PS1/PS2` を維持。表示名とは分離 |
| Console level JSON | G5 までは形式を変更しない |
| engine 配布 | workspace 内 package。外部 npm 公開は対象外 |
| browser support | 現行 `Opus5ConsoleChaos` と同等。追加ブラウザは G6 で判断 |

---

## 12. 最初に着手する順序

最初の実装では、次の順を崩さない。

1. `P0-01`: 参照 SHA とファイル hash の記録
2. `P0-02`: 読み取り専用の参照元から、本リポジトリへ無変更取り込み
3. `P0-03`: 複製側で現行 verify を再現
4. `P0-04`〜`P0-06`: state/image/audio の比較基準作成
5. `P1-01`〜`P1-03`: workspace と境界検査
6. `P1-05`: 空の GameModule で lifecycle を確定
7. `P2-01`: 最も独立している core から抽出開始

比較基準が揃う前に `profiles.ts` や `renderer3d.ts` の分割へ着手しない。
この順序により、ゲームエンジン化そのものが現行ゲームの再現性を損なっていないことを、各段階で証明できる。
