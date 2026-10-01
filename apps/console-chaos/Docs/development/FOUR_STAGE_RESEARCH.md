# 4ステージ体験版 — 現状調査・検証記録

調査日: 2026-10-02（日本時間）

対象: ConsoleChaosEngine `main`・`558fae0`、`apps/console-chaos`

企画への反映先: [4ステージ体験版企画書](../FOUR_STAGE_DEMO_PLAN.md)

## 1. 調査の目的と範囲

初回15〜30分のデモで、「世代を切り替えて進む」「世代ごとの技術を見せる」が成立するかを調べた。既存企画、レベル、ゲームロジック、描画command、エンジンの実装、実際のブラウザ画面、既存テストを照合した。

区別したのは、プロファイルに宣言された能力、エンジンが処理する能力、本アプリが実際に使う能力、プレイヤーの行動へ結びつく仕掛けの四つ。設定にフラグがあるだけでは、実画面の見せ場とは扱わない。

外部の初見プレイヤーによる試遊は行っていない。所要時間、分かりやすさ、面白さは未評価。ブラウザでの観察と自動シミュレーションは、それぞれ画面とルールの確認であり、人の体験評価の代わりにはならない。

## 2. 既存の構成と再利用できるもの

| 項目 | 現状 | 根拠 |
| --- | --- | --- |
| レベル | `area1`: 252要素、8区画、6パズル、8チェックポイント、1ゴール | [area1.json](../../public/assets/levels/area1.json) |
| 補助レベル | `mini`: 5要素、パズルなし。`puzzle_lab`: 66要素、6パズル、ゴールなし | [mini.json](../../public/assets/levels/mini.json)、[puzzle_lab.json](../../public/assets/levels/puzzle_lab.json) |
| 切替 | 通常350ms。遷移中は二世代を描画し、投影変更時は押し出し・接地先Zへの吸着を処理 | [generation/controller.ts](../../../../packages/engine/src/generation/controller.ts)、[session.ts](../../src/gameplay/session.ts) |
| 世界・衝突 | 世界は単一3D座標。CH 1・2ではZを無視し、CH 3・4ではZを含む衝突判定 | [projection.ts](../../src/gameplay/projection.ts) |
| 移動 | CH 1は停止時0.25刻み。CH 2は壁ジャンプ。CH 3・4はジャンプの高さ調整とShiftで微調整 | [generation.ts](../../src/config/generation.ts)、[player.ts](../../src/gameplay/player.ts) |
| 落下復帰 | チェックポイントへ戻る。フェードアウト12tick＋イン12tick、60Hzなら約0.4秒 | [checkpoint.ts](../../src/gameplay/checkpoint.ts) |
| ヒント | 自動段階は3・5・7分。直接解法はHで要求する | [hints.ts](../../src/gameplay/hints.ts) |
| 進行 | タイトル、プレイ、クリア、再挑戦。4ステージ連続ロードは未実装 | [game_flow.ts](../../src/ui/game_flow.ts) |
| 保存 | 設定と試遊ログの保存はある。ゲーム進行保存は未実装 | [save.ts](../../src/gameplay/save.ts) |
| 戦闘 | 攻撃入力・判定の基礎はあるが、敵AI・ダメージ・HP・ボスを組み合わせた戦闘ループはない | [player.ts](../../src/gameplay/player.ts)、[session.ts](../../src/gameplay/session.ts) |

切替中の無敵は、落下や移動床の突然の変位を止める保証ではない。デモでは安全な比較地点を配置し、切替直後の足場と移動方向を検証する必要がある。

旧 [GAME_PLAN.md](GAME_PLAN.md) はチュートリアル＋6エリア、2〜3時間の本編構想。[PHASE2_GIMMICK_PLAN.md](PHASE2_GIMMICK_PLAN.md) には、そこから変更された仕掛けの理由がある。旧企画の専用世代、影、反射、音・入力の課題を、そのまま実装済みとして扱わない。

## 3. 六つの仕掛けの実態

| 仕掛け | 現在の行動・条件 | 調査から分かったこと | デモへの反映 |
| --- | --- | --- | --- |
| F-1 色の潰れ | CH 1で二本のツタが太い橋になる。CH 3・4では細い緑のツタも渡れる。CH 2の脆いツタは接触で崩れる | CH 1は楽な解法で、唯一の解法ではない。橋の実体は`paletteMode`で切り替え、GPUの出力色を読んで決めてはいない | 序盤で「古い世代が便利」を教える。筋の通る3Dの別解を残す |
| F-2 ちらつきの隙間 | 12組の幕がCH 1の走査線上限8を超え、4つの灯から10枚中4枚の正解石を読む | 欠けるのは情報を覆う幕。非表示の幕と衝突の消失は連動しない。正解を知れば別世代でも渡れるが、現行の解決印はCH 1の台座接触に限定される | 「CH 1で観察、好きな世代で渡る」を許すには達成条件も変更。落下ごとの正解変更はデモでは保持へ改訂 |
| S-1 回る床 | CH 2で島が半径3m・12秒周期で公転し、乗る人を運ぶ。半透明の踏み台が実体化する | 描画は水平quadをY軸回転するmesh。画面アフィン面APIは未使用。真横カメラでは床面の大きな回転が読みにくい | 面を画面へ接続し、表示・移動・衝突を共通座標で合わせる優先試作 |
| P1-1 裏側 | CH 3・4で壁の裏へ回り、スイッチに触れる | 奥行きのある両世代で成立。現状の解決は、実際の門の開閉へつながっていない | ステージ1の出口へ接続。CH 3だけの専用解法にしない |
| P1-2 ソートの継ぎ目 | CH 3の`perspective3d && !depthBuffer`で、固定した継ぎ目のcolliderを無効にする | 実際の描画順の破れや観察角度を読み取って通行を決める仕組みではない | 同じ装置状態から、見える入口と通れる入口を作る。世界の信号装置の規則として伝える |
| P2-1 暗闇と松明 | CH 4の携帯点光源で折れた廊下を照らす。解決印は`dynamicLight`のある世代で刻印に接触すると付く | 照明の距離・遮蔽を判定しているわけではない。CH 1・2はZの折れを無視して直進できる | 光の距離と刻印の反応を接続する。通路の横断だけでは出口を開けない |

実装参照: [F-1](../../src/gameplay/puzzles/f1_color_crush.ts)、[F-2](../../src/gameplay/puzzles/f2_flicker_gap.ts)、[S-1](../../src/gameplay/puzzles/s1_affine_plane.ts)、[P1-1](../../src/gameplay/puzzles/p1_1_backside.ts)、[P1-2](../../src/gameplay/puzzles/p1_2_sort_break.ts)、[P2-1](../../src/gameplay/puzzles/p2_1_torch.ts)、[描画frame](../../src/presentation/frame.ts)。

### S-1で、カメラ変更だけでは足りない理由

島はXZ平面を公転するが、CH 2の操作と衝突はXYを使いZを無視する。上から島を描くだけでは、見える位置と乗れる位置を一致させられない。画面アフィン面とXY物理の共通写像を試すか、区間専用の構図を採る場合も操作・衝突を併せて検討する必要がある。

また、CH 2以外へ切り替えると公転角が即座にπへ変わる。島だけでなく、接地しているプレイヤーも移動差分で運ばれる。切替のたびに大きく飛ばされる仕様は、自由に比較するデモと相性が悪い。位相を保持して停止するなど、追加の挙動設計が必要。

## 4. 世代別技術: 宣言と使用の照合

| 世代・技術 | エンジンでの実装 | 本アプリでの使用と限界 |
| --- | --- | --- |
| CH 1 / 色 | 固定54色への量子化、16pxブロックで背景共通色＋頻出3色を扱う二段処理 | 使用済み。プロファイルの全画面25色上限は強制されない |
| CH 1 / 表示数 | 走査線あたりのsprite選別 | 使用済み。F-2の幕を欠けさせる |
| CH 1 / ラスタ面 | `rasterSurfaces`の専用描画経路 | 調査したゲーム場面はcommandが0。デモの必須見せ場には採らない |
| CH 2 / 色・合成 | RGB555量子化、色の加算・減算と半値合成 | 使用済みの素材には加算半値がある。256色上限・8pxブロック制限は強制されない |
| CH 2 / 面の変形 | `affineSurfaces`の専用描画経路 | 調査したゲーム場面はcommandが0。S-1のmesh回転と混同しない |
| CH 3 / 不安定な3D | 頂点量子化、アフィンUV、depth無効、12段のordering tableとtriangle単位の分割 | 使用済み。ただし、継ぎ目の通行条件は別のゲームロジック |
| CH 4 / 安定した3D | depth、球状の点光源による距離減衰 | 使用済み。点光源は強度最大の1個を選択。方向・遮蔽は扱わない |
| CH 4 / 影 | 床へ投影するquad | 任意の物体へ落ちるshadow mapではない。精密な影の推理に使わない |
| CH 4 / 反射 | 静的なequirectangular環境テクスチャを使う経路 | 本アプリは環境テクスチャを供給していない。動く世界の鏡像ではない |
| 音楽 | 同じ譜面の編曲切替と拍の継続 | アプリで使用済み。四世代を同じ旋律で比較できる |
| 音源・定位 | 世代別の簡略化された合成、CH 4のPanner経路 | 実機BRR/ADPCMの完全な復号・再現ではない。アプリSFXは位置引数を渡しておらず、方向音の謎は未成立 |
| 入力 | 世代別移動設定、3Dでの微調整 | 使用済み。感圧、振動、自由カメラは、宣言や構想だけで遊びへ接続されたとは扱わない |

根拠:

- [世代プロファイル](../../../../packages/engine/src/generation/profiles.ts)、[量子化pipeline](../../../../packages/engine/src/render/generation-pipeline.ts)
- [WebGL renderer](../../../../packages/engine/src/render/webgl-renderer.ts)、[光源選択](../../../../packages/engine/src/render/lighting.ts)、[点光源shader](../../../../packages/engine/src/render/shaders/ps1_forward.ts)
- [アプリの描画command](../../src/presentation/frame.ts)、[アプリの世代設定](../../src/config/generation.ts)
- [音楽編曲](../../src/audio/music.ts)、[音楽presenter](../../src/audio/presenter.ts)、[効果音](../../src/audio/sfx.ts)、[エンジン音源](../../../../packages/engine/src/audio/engine.ts)

実機の正確な再現ではなく、世代技術を題材にしたゲーム表現として扱う。プレイヤーへの説明も「少ない色で道がまとまる」「動く面に乗る」のように、現象と行動へ結びつける。

## 5. ブラウザでの画面検証

`/?scene=mini&level=area1&playtest=0` をChromium、1280×820、software WebGL2で起動。開始地点、ツタ、回る床、群れの幕、継ぎ目、松明の6地点をCH 1〜4で観察し、24枚の画面と描画commandを記録した。

各地点への配置には開発用APIを使用し、ホストを停止して手動frameを進めた。世代切替を完了させ、要求した世代とrendererへ渡る世代が一致することを全24サンプルで確認した。通常操作での自然な通しプレイ、同一時刻の厳密な画像比較、GPU性能測定ではない。

| 観察対象 | 結果 | 解釈 |
| --- | --- | --- |
| 起動と素材 | ページ例外0、失敗した素材要求0 | この観察環境で画面を表示できた |
| 画面アフィン・ラスタ面 | 24サンプルすべてで`affineSurfaces=0`、`rasterSurfaces=0` | 本アプリの見せ場に専用面APIが使われていない。エンジン側の未実装を意味しない |
| CH 2の回る床 | カメラは真横のorthographic。島と踏み台はあるが、水平面の大きな変形を見せる構図になっていない | S-1の成立フラグと島の公転だけでは、企画が求める技術展示に足りない |
| CH 4の松明 | 暗室で局所的に照らされた板と縁が見える | 点光源の経路は動作。初見で進路が読み取れるかは人の試遊が必要 |
| 投影切替 | CH 1・2の横視点とCH 3・4の斜視点で、カメラと進行方向の見え方が変わる | 共通の目印と安全な比較場所が必要 |

生の画像、command記録、再現スクリプトはGit管理外の `Docs/measurements/four-stage-research/` に保存した。この文書は、ローカル画像がなくても読めるように観察方法と結論を記している。

## 6. 攻略条件の再現検証

アプリと共通の`createSession`・`tickSession`、既存リプレイharnessを使った。ゲームロジック、既存テスト、レベルを変更せず、初期位置・世代・入力だけを指定して再現した。描画を含まないため、画面の読みやすさは評価していない。

### A. CH 4を使わず終盤からクリア

`area1`、seed `4417633`、P2-1入口 `[97, -3, 0]`、初期CH 1で開始。

1. 右へ280tick進む。
2. CH 3へ切り替え、合計42tick進める。
3. 斜め入力 `[1, -1]` を25tick、右入力を60tick進める。

結果: 407tick、最終位置 `[118.020453, -3.2, -1.620453]`、復帰0回、解決済みパズル0件で `cleared=true`。CH 4は一度も使用していない。

これは**終盤だけの検証**であり、タイトルから全区間を通れることを実証したものではない。`session.ts` のゴール接触判定には、パズル解決を要求する条件がない。光のある道を見せるだけでは、世代の使い分けを進行へ接続できない。

### B. F-2をCH 2で物理的に渡る

既存 [f2_flicker_hint.replay.json](../../tests/unit/replay/f2_flicker_hint.replay.json) の初期世代だけをFCからSFCへ変更。seed、spawn、全入力は同じ。

結果: 192tick、位置 `[30.983333, 0.8, 0]`、台座の奥端 `x=30.5` を越え、復帰0回、解決印なし。

正解を知る入力なら渡れることと、初見で正解を発見できることは別である。デモで「CH 1で読んで、CH 2で渡る」を認めるには、現行の台座接触時の世代制限を改訂する必要がある。

### C. 既存通しリプレイの限界

[area1_full_run.replay.json](../../tests/unit/replay/area1_full_run.replay.json) は1916tick、約31.9秒で6件の解決を検査するが、終了位置は `x≈109.916` で、`x=117` の実際のゴールに到達しない。既知の入力を再生する回帰検査であり、4ステージの連続クリアや初見15〜30分の証明には使えない。

## 7. 既存テストの結果と再実行

調査に関係する既存テストを実行し、以下が成功した。パズル系は両グループに含まれるため、件数を単純合算しない。

| グループ | 結果 | 主な範囲 |
| --- | --- | --- |
| アプリのゲームプレイ | 8ファイル、120件成功 | パズル、リプレイ、プレイヤー、投影、復帰、ヒント、クリア、UI進行 |
| エンジン描画の契約・参照計算 | 5ファイル、23件成功 | 面・環境反射のCPU計算、描画規則、blend、ordering分割 |
| アプリの描画接続 | 4ファイル、46件成功 | パズル、世代pipeline、presentation frame、描画アルゴリズム |

リポジトリルートで実行:

```sh
npm exec --workspace apps/console-chaos -- vitest run tests/unit/puzzles.test.ts tests/unit/replay.test.ts tests/unit/player.test.ts tests/unit/projection.test.ts tests/unit/checkpoint.test.ts tests/unit/hints.test.ts tests/unit/session-clear.test.ts tests/unit/game_flow.test.ts
npm exec --workspace packages/engine -- vitest run tests/surface-render.test.ts tests/environment-render.test.ts tests/render-mapping-reference.test.ts tests/blend-ordering.test.ts tests/ordering-partition.test.ts
npm exec --workspace apps/console-chaos -- vitest run tests/unit/puzzles.test.ts tests/unit/generation-pipeline.test.ts tests/unit/presentation-frame.test.ts tests/unit/render-algorithmic.test.ts
```

エンジンの23件はCPU側の参照計算や描画契約の検査であり、本アプリで未使用の画面アフィン面・環境反射を実GPUで描画した検証ではない。

テスト成功は現行の個別規則が動作する根拠。解決前のゴール接触を防ぐこと、技術が大きく見えること、初見で楽しめること、新企画が完成したことの保証ではない。

## 8. 外部資料と調査上の限界

NES表現の設計例、同じ場所を異なる移動能力で捉える設計例、環境から操作を学ぶ設計例を調べるため、Yacht Club Gamesの「Breaking the NES」、任天堂の「Iwata Asks: A Link Between Worlds」、Valve Developer Communityの「Portal 2/Developer commentary」へのアクセスを試した。この環境ではHTTPSプロキシがすべて403を返し、本文を読めなかった。記事内容を出典として引用したり、本企画の妥当性の裏付けにしたりはしていない。

今回の企画判断は、リポジトリ内の一次資料と実行検証に基づく。残る主な不確実性は、CH 2の面と操作の同期、継ぎ目の視認性、光と刻印の反応の一致、統合装置の理解と所要時間。企画書のM0〜M5で、試作と初見試遊の採用条件として扱う。
