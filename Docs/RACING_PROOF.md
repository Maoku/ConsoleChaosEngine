# Racing による再利用性の証明

## 成立している縦切り

`apps/racing` は閉じた1コース、player 1台、deterministic path-following AI 1台、3周で構成する。

- 3秒 countdown → race → 3 lap finish → result → `R` restart
- fixed-step kinematic car、加速、ブレーキ、ステア、逆走、路外減速、境界 collision、最後の安全位置へ復帰
- checkpoint の順序とコース接線の向きが一致したときだけ lap 加算
- lap + spline progress による2台の順位
- keyboard/gamepad ActionMap
- CH1〜CH4 を実行中に切替。解像度、palette、CRT signal、projection、filter、入力、voice limit が hardware profile から変わる
- racing 固有 theme は色、camera zoom、車/コース/HUDだけを所有する

## 使用した engine 公開 API

| 領域 | API |
|---|---|
| lifecycle | `GameModule`, `GameHost`, fixed update, dispose |
| core | fixed 60 Hz loop、deterministic context RNG |
| generation | `HARDWARE_GENERATION_PROFILES`, `GenerationController`, `GenerationVariant` |
| input | `defineActions`, `createActionMap`, keyboard/gamepad `DeviceSnapshot` |
| render | `RenderFrame`, `MeshCommand`, `SpriteCommand`, overlays、canvas command renderer |
| audio | `AudioService`, phase-stable `MusicClock`, generation voice limit |
| physics | `nearestPointOnSegment`（コース中心線 query） |
| platform | browser loop、resize、audio unlock |

## 境界証跡

- `apps/racing` から `apps/console-chaos` への import は0件。
- engine deep import は0件。すべて `@console-chaos/engine` から参照する。
- `packages/engine/src` に puzzle/torch/hero/lap/race の語彙を許可しない静的検査がある。
- 境界 checker は意図的違反 fixture を自己検査し、検出できなければ失敗する。

## 自動検査

- Racing unit: kinematic replay、collision、AI 3周完走、順方向 checkpoint、逆走拒否、3周、countdown/restart、4 theme。
- Racing E2E: public GameHost で boot/update/render/CH1→CH4 switch/audio/dispose。
- 本番 Vite build: Console とは別 entry/dist として成功。
- 実ブラウザ: CH3 と CH1 を描画し、切替後の HUD/量子化/scanline 差を確認。console error/warning 0件。

