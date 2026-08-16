# @console-chaos/asset-pipeline

Console Chaos の世代能力から、決定論的な PNG アセットを生成・検査する Node.js 22+ / ESM 専用 package です。
ブラウザ runtime には組み込まず、ゲームの build-time tool からだけ利用します。

## CLI

```sh
console-chaos-assets build --config tools/art.config.mjs
console-chaos-assets build --config tools/art.config.mjs --only chapel
console-chaos-assets build --config tools/art.config.mjs \
  --only chapel --set background.tone.FC.saturation=1.9
console-chaos-assets build --config tools/art.config.mjs --out-dir build/art-trial --dry-run
console-chaos-assets check --config tools/art.config.mjs
```

- `--only <id>` は素材 ID を限定します。未知の ID はエラーです。
- `--generation <FC|SFC|PS1|PS2>` は世代を限定し、複数指定できます。
- `--set path=value` は既存 recipe 値だけを型を保って上書きします。
- `--set` を全素材へ適用する場合は `--allow-all-overrides` が必要です。
- `--out-dir` は試行出力を製品アセットから分離します。
- `--dry-run` は入力を検証し、build callback や書き込みを行わず適用 spec を表示します。
- `check` は再生成結果を decode 後 RGBA と manifest で比較し、出力を書き換えません。

runner は全入力・recipe・出力を検証し、全世代の生成が成功した後にだけ一時ファイルを差し替えます。
同じ画素の PNG は書き直さないため、Node.js/zlib の版による圧縮バイト差も発生しません。

## 設定

設定は `defineAssetClass` と `defineAssetPipeline` で定義します。完全なひな型は
[`templates/art.config.mjs`](./templates/art.config.mjs) を参照してください。

```js
import { defineAssetClass, defineAssetPipeline, resample } from '@console-chaos/asset-pipeline';

const portrait = defineAssetClass({
  id: 'portrait',
  colorBudget: { FC: 4, SFC: 15, PS1: 256, PS2: null },
  targetSize: generation => ({ FC: 144, SFC: 146, PS1: 154, PS2: 296 })[generation],
});

export default defineAssetPipeline({
  rootDir: '..', // config が tools/art.config.mjs にある場合
  recipe: { portrait: { gamma: 1 } },
  assets: [{
    id: 'hero',
    source: 'base/hero.png',
    assetClass: portrait,
    outputs: {
      FC: 'assets/hero-fc.png', SFC: 'assets/hero-sfc.png',
      PS1: 'assets/hero-ps1.png', PS2: 'assets/hero-ps2.png',
    },
  }],
  build({ source, spec }) {
    return resample(source, spec.width, spec.height);
  },
});
```

`spec` の内部解像度、palette mode、palette block、tile snap、alpha、filter、FC master palette は
`@console-chaos/engine` の `HARDWARE_GENERATION_PROFILES` から導出されます。素材単位の色数予算と版面だけを
ゲーム側で宣言してください。

## source画像と変形の方針

asset pipelineの既定責務は、source画像の意味を保ったまま世代能力へ変換することです。
`crop`、`resample`、grid snap、tone、palette、alpha量子化は通常の世代変換に含まれます。

sourceに存在しない姿勢、表情、目パチ、髪や衣装の動きを、shear / warp / 局所変形で作ってはいけません。
「揺らす」「目パチさせる」という機能要求だけでは、これらの変形方式を許可されたものと解釈しません。
必要な状態は変換元frameとして用意するか、sourceの意味を変えないruntimeの平行移動・回転などで表現します。

shear / warpを使用できるのは、ユーザーがその方式を明示的に指示した場合だけです。その場合も、意図、対象範囲、
parameter、provenanceを記録し、決定的な再生成と自動・目視検査を必須とします。詳細と具体例は
[`ASSET_RULES.md`](./ASSET_RULES.md#幾何変形の境界) を参照してください。

## Manifest

入力・出力 path は設定ファイルから `rootDir` で指定した project root を基準にします。既定では設定ファイルの
directory が root です。`asset-manifest.json` へ記録するのは package / Engine
version、generation profile digest、相対 source/output path、source/recipe/RGBA SHA-256、寸法、色数、alpha、palette
情報です。時刻と絶対 path は含めません。

画像 API は package root から公開されます。PNG は 8bit RGB/RGBA・非 interlace だけを受け付け、対応外形式を
暗黙変換しません。共通規則は [`ASSET_RULES.md`](./ASSET_RULES.md) が正本です。
