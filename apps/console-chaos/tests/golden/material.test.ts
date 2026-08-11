/**
 * 材質表とテクスチャのゴールデン（T1-21 / T1-23）。
 *
 * ここが守るのは 2 つ。
 *   1. area1 に置かれた**すべての種別**が見た目を持つこと（灰色の箱に戻らないこと）
 *   2. F-1 の前提「CH 1 で完全に同一色・CH 2 で別の色」が**実物のテクスチャで**成り立つこと
 *
 * 2 は所見 2 の中心にある問題そのものなので、絵の側で崩れたら CI で止める。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../../tools/png';
import { MATERIALS, materialFor, requiredModels, requiredTextures } from '@/render/material';
import { nearestMasterIndex } from '@/render/quantize/master_palette';
import { quantizeChannel } from '@/render/quantize/palette_sfc';
import { parseLevel } from '@/level/loader';
import { PROFILES } from '@/generation/profiles';
import { TEXTURE_SPECS } from '../../tools/texture_spec';

const TEXTURE_DIR = 'public/assets/textures';
const area1 = parseLevel(JSON.parse(readFileSync('public/assets/levels/area1.json', 'utf8')), 'area1.json');

/**
 * KV-03 でテクスチャは世代ごとの 4 セットに分かれた。
 * F-1 の前提は**セットごとに違う**（第1世代のセットでは潰れ、第2世代のセットでは残る）ので、
 * どちらのセットを見ているかを明示して読む。
 */
function vineOf(set: string, entity: string) {
  return decodePng(readFileSync(join(TEXTURE_DIR, set, materialFor('vine', entity).texture)));
}

describe('材質表', () => {
  it('area1 のすべての種別に見た目がある（既定へ落ちない）', () => {
    const types = [...new Set(area1.entities.map((entity) => entity.type))].sort();
    expect(types.length).toBeGreaterThanOrEqual(14);
    for (const type of types) expect(MATERIALS[type], `${type} の材質が無い`).toBeDefined();
  });

  it('5 群がすべて使われている（背景 / 足場 / 仕掛け / 敵 / 目標）', () => {
    const roles = new Set(area1.entities.map((entity) => materialFor(entity.type, entity.id).role));
    expect([...roles].sort()).toEqual(['background', 'enemy', 'gimmick', 'goal', 'platform']);
  });

  it('要求するテクスチャが 4 セットすべてに実在する（KV-03）', () => {
    for (const profile of Object.values(PROFILES)) {
      for (const file of requiredTextures()) {
        const path = join(TEXTURE_DIR, profile.art.textureSet, file);
        expect(existsSync(path), `${path} が無い`).toBe(true);
      }
    }
  });

  it('要求するモデルが実在する', () => {
    for (const model of requiredModels()) {
      expect(existsSync(join('public/assets/models', `${model}.gltf`)), `${model}.gltf が無い`).toBe(true);
    }
  });

  it('F-1 のツタ 2 本は別の材質に割り当てられている', () => {
    expect(materialFor('vine', 'f1_vine_a').texture).not.toBe(materialFor('vine', 'f1_vine_b').texture);
  });

  it('細い箱に貼る絵は、実際に面へ出る帯に中身がある（F-1 の綱）', () => {
    // **`boxMesh` は UV をワールド寸法から作る**（`uv = 半径 × uvScale`）。
    // 8m × 0.5m の綱に `uvScale: 1` で貼ると、太さの向きには半周期しか乗らず、
    // しかも面の中心が v = 0 なので**絵の上下の端**が綱の中心に出る。
    // 端が透明な絵（縦に伸びる蔓）を貼ると、綱が千切れた鉤の列になる。
    // 詳細は Docs/measurements/F1_rope_uv.md
    //
    // 周期の数ではなく**実際に出る帯の不透明率**を見る。半周期しか乗らなくても、
    // そこに芯が通っていれば綱として読めるからである（直す前は 7%、直したあとは 28.5%）。
    // 透過を持つ絵にだけ課す：隙間なく塗られた石畳なら、どこを切り取っても面は消えない
    const alphaFiles = new Set(TEXTURE_SPECS.filter((spec) => spec.alpha).map((spec) => spec.file));
    for (const entity of area1.entities) {
      const material = materialFor(entity.type, entity.id);
      if (material.uvScale === 0 || material.model !== null || material.collisionOnly) continue;
      if (!alphaFiles.has(material.texture)) continue;
      const half = entity.collider?.halfExtents ?? entity.transform.scale ?? [1, 1, 1];
      // いちばん薄い辺が面の v になる。UV は面の中心が 0 なので、帯は 0 をまたぐ
      const reach = Math.min(0.5, Math.min(...half) * material.uvScale);
      const image = decodePng(readFileSync(join(TEXTURE_DIR, PROFILES.PS2.art.textureSet, material.texture)));
      let opaque = 0;
      let rows = 0;
      for (let y = 0; y < image.height; y++) {
        const v = y / image.height;
        if (v > reach && v < 1 - reach) continue;
        for (let x = 0; x < image.width; x++) if (image.data[(y * image.width + x) * 4 + 3]! > 0) opaque++;
        rows++;
      }
      const ratio = opaque / (rows * image.width);
      expect(ratio, `${entity.id}（${entity.type}）の面に出る帯が ${(ratio * 100).toFixed(1)}% しか塗られていない`)
        .toBeGreaterThan(0.2);
    }
  });

  it('透過を持つ絵を貼る材質は、必ず抜きを掛けている', () => {
    // **抜きを掛けないと透明な画素が黒として描かれる。**
    // シェーダは半透明合成を持たない世代でも通るよう `vec4(color, base.a)` を返すだけで、
    // 混ぜるかどうかは呼ぶ側が決める。改訂前は背景が夜だったので黒が背景に紛れており、
    // SG-03 で空が昼になったとたん、ツタの板が空を黒く塗り潰した
    const spec = new Map(TEXTURE_SPECS.map((s) => [s.file, s]));
    for (const [type, material] of Object.entries(MATERIALS)) {
      if (material.collisionOnly) continue;
      const files = [material.texture, material.topTexture].filter((f): f is string => f !== null);
      for (const file of files) {
        if (!spec.get(file)?.alpha) continue;
        expect(material.alphaCutoff, `${type} が ${file} を抜き無しで貼っている`).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * 天面テクスチャ（SG-04、上位計画 §1 の C）。
 *
 * 基準画の足場は**天面が草・側面が砂岩**である。1 枚の絵では出せないので
 * 2 枚目のサンプラを足した。**ドローコールは増えない。**
 */
describe('天面テクスチャ（SG-04）', () => {
  const RENDERER = readFileSync('src/render/renderer3d.ts', 'utf8');
  const SHADER = readFileSync('src/render/shaders/ps1_forward.glsl', 'utf8');

  it('足場は天面が草・側面が砂岩になっている', () => {
    for (const type of ['platform', 'island', 'bridge_far']) {
      const material = MATERIALS[type]!;
      expect(material.texture, type).toBe('stone_wall.png');
      expect(material.topTexture, type).toBe('grass_top.png');
    }
  });

  it('空の見えない部屋には草を生やさない（暗室の足場は天面を持たない）', () => {
    // 暗室かどうかは**場所**の話（BR-03）。世代の分岐ではないことを材質の側で見る
    expect(MATERIALS['causeway']!.interior).toBe(true);
    expect(MATERIALS['causeway']!.topTexture).toBeNull();
  });

  it('要求するテクスチャの一覧に天面の絵も入る（4 セットに揃うことの前提）', () => {
    expect(requiredTextures()).toContain('grass_top.png');
  });

  it('シェーダが読む絵は 2 枚だけ（レイヤシステムを作らない）', () => {
    const samplers = SHADER.match(/uniform sampler2D \w+/g) ?? [];
    expect(samplers).toEqual(['uniform sampler2D uBaseColor', 'uniform sampler2D uTopColor']);
  });

  it('1 枚目を束ねるすべての場所で 2 枚目も束ねている', () => {
    // **束ね忘れると GL がユニット 1 の残り（＝直前に誰かが置いた絵）を拾う。**
    // 材質が天面を持たない場合も 1 枚目と同じ絵を束ねる必要があるので、数が一致する
    const base = RENDERER.match(/uBaseColor:/g) ?? [];
    const top = RENDERER.match(/uTopColor:/g) ?? [];
    expect(base.length).toBeGreaterThanOrEqual(5);
    expect(top.length).toBe(base.length);
  });
});

/**
 * 動くもの（SG-07 / SG-08）。
 *
 * **動きは 2 つしか無い**（上下の揺れと UV の送り）。汎用のアニメーション機構は作らない。
 * どちらも `Renderer3dOptions.motionAmount()` が掛かり、0 で完全に止まる（判断 I）。
 */
describe('動くもの（SG-07 / SG-08）', () => {
  const RENDERER = readFileSync('src/render/renderer3d.ts', 'utf8');

  it('上下に揺れるのは空の立方体だけ', () => {
    const floating = Object.entries(MATERIALS).filter(([, material]) => material.float > 0);
    expect(floating.map(([type]) => type)).toEqual(['sky_cube']);
  });

  it('空の立方体は足場と同じ材質でできている（語彙を増やさない）', () => {
    // 基準画の浮遊する立方体は足場そのもの。絵もモデルも新しくしない
    expect(MATERIALS['sky_cube']!.texture).toBe(MATERIALS['platform']!.texture);
    expect(MATERIALS['sky_cube']!.topTexture).toBe(MATERIALS['platform']!.topTexture);
    expect(MATERIALS['sky_cube']!.decoration).toBe(true);
  });

  it('UV を送るのは滝だけで、半透明ではない', () => {
    const scrolling = Object.entries(MATERIALS).filter(([, material]) => material.uvScrollY !== 0);
    expect(scrolling.map(([type]) => type)).toEqual(['waterfall']);
    // **加算合成を持たない第1世代でも抜きで成立する。** 半透明にすると第1世代で描かれない
    expect(MATERIALS['waterfall']!.translucent).toBe(false);
    expect(MATERIALS['waterfall']!.alphaCutoff).toBeGreaterThan(0);
  });

  it('UV は頂点シェーダで送る（アフィン補間の前後がずれないように）', () => {
    // フラグメント側でずらすと、割り戻した後の UV を動かすことになり、
    // 第3世代の歪みそのものが動いてしまう
    const vertex = readFileSync('src/render/shaders/ps1_vertex.glsl', 'utf8');
    const fragment = readFileSync('src/render/shaders/ps1_forward.glsl', 'utf8');
    expect(vertex).toMatch(/uniform vec2 uUvScroll/);
    expect(fragment).not.toMatch(/uUvScroll/);
  });

  it('動きの強さは 1 か所から配れる（光過敏への配慮の受け皿。判断 I）', () => {
    // `float` と `uvScrollY` の両方に motionAmount が掛かっていること。
    // 片方だけ掛け忘れると「動きを止めた」のに滝だけ流れ続ける
    expect(RENDERER).toMatch(/motionAmount\?\.\(\) \?\? 1/);
    expect(RENDERER).toMatch(/material\.float \* motion/);
    expect(RENDERER).toMatch(/material\.uvScrollY \* motion/);
  });
});

/**
 * 紋の語彙（KV-09）。**目標も仕掛けも同じハート 1 つに揃っている**ことを形で見る。
 *
 * 色は世代ごとに違うので、色では比べられない。中心の色を「紋の色」として拾い、
 * 行ごとの連続の数と幅からハートの輪郭を確かめる。
 */
describe('紋の語彙（KV-09）', () => {
  // SG-10 で門の光を足した。**台座・刻印・門が同じ 1 つの形に揃っている**ことを見る
  const GLYPHS = ['mark_glyph.png', 'pedestal_top.png', 'gate_glow.png'];
  /** 板に貼る絵は上下が入れ替わって保存されている（`TextureSpec.flip`）ので、行を逆から読む */
  const flipped = new Set(TEXTURE_SPECS.filter((spec) => spec.flip).map((spec) => spec.file));

  /** 行ごとの「紋の色」の連続（開始と終わりの組） */
  function runsOf(image: ReturnType<typeof decodePng>, y: number, color: readonly number[]): number[][] {
    const runs: number[][] = [];
    let start = -1;
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      const same = [0, 1, 2].every((c) => image.data[i + c] === color[c]);
      if (same && start < 0) start = x;
      if (!same && start >= 0) {
        runs.push([start, x]);
        start = -1;
      }
    }
    if (start >= 0) runs.push([start, image.width]);
    return runs;
  }

  for (const set of Object.values(PROFILES).map((profile) => profile.art.textureSet)) {
    for (const file of GLYPHS) {
      it(`${set}/${file} がハートの輪郭を持つ`, () => {
        const image = decodePng(readFileSync(join(TEXTURE_DIR, set, file)));
        const center = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
        const glyph = [0, 1, 2].map((c) => image.data[center + c]!);

        // 行ごとに「紋の色」がどこにあるかを集め、**画面の上から下へ**見ていく
        const order = Array.from({ length: image.height }, (_, i) =>
          flipped.has(file) ? image.height - 1 - i : i,
        );
        const rows = order.map((y) => ({ y, runs: runsOf(image, y, glyph) }));
        const filled = rows.filter((row) => row.runs.length > 0);
        expect(filled.length, '紋の色が 1 画素も無い').toBeGreaterThan(10);

        // 上のほうに、離れた 2 つの山（ハートの左右の膨らみ）がある
        const lobes = filled.slice(0, Math.floor(filled.length / 3)).some((row) => row.runs.length === 2);
        expect(lobes, '上部に 2 つの山が無い（ハートに見えない）').toBe(true);

        // 下へ行くほど細くなり、最後は 1 本の細い先になる
        const widthOf = (row: (typeof filled)[number]): number =>
          row.runs[row.runs.length - 1]![1]! - row.runs[0]![0]!;
        const widest = Math.max(...filled.map(widthOf));
        const last = filled[filled.length - 1]!;
        expect(last.runs.length, '先が 1 本に絞られていない').toBe(1);
        expect(widthOf(last)).toBeLessThan(widest * 0.25);
      });
    }
  }
});

describe('F-1 の前提（ツタ 2 本の色）', () => {
  const fcSet = PROFILES.FC.art.textureSet;
  const sfcSet = PROFILES.SFC.art.textureSet;
  const a = vineOf(fcSet, 'f1_vine_a');
  const b = vineOf(fcSet, 'f1_vine_b');

  it('形状（透過の輪郭）が完全に一致する', () => {
    for (const set of Object.values(PROFILES).map((profile) => profile.art.textureSet)) {
      const left = vineOf(set, 'f1_vine_a');
      const right = vineOf(set, 'f1_vine_b');
      expect([left.width, left.height], set).toEqual([right.width, right.height]);
      for (let i = 3; i < left.data.length; i += 4) {
        expect(left.data[i]! > 0, `${set} の画素 ${i / 4}`).toBe(right.data[i]! > 0);
      }
    }
  });

  // シェーダの陰影は 0.45 + 0.55 * lambert。下限・上限と中間を見る
  for (const level of [1.0, 0.85, 0.7, 0.55, 0.45]) {
    it(`CH 1（固定パレット・明度 ${level}）では全画素が同じ色に潰れる`, () => {
      for (let i = 0; i < a.data.length; i += 4) {
        if (a.data[i + 3] === 0) continue;
        const left = nearestMasterIndex(a.data[i]! * level, a.data[i + 1]! * level, a.data[i + 2]! * level);
        const right = nearestMasterIndex(b.data[i]! * level, b.data[i + 1]! * level, b.data[i + 2]! * level);
        expect(left, `画素 ${i / 4} の色が一致しない`).toBe(right);
      }
    });
  }

  it('CH 2（RGB555）では別の色のまま残る', () => {
    const left = vineOf(sfcSet, 'f1_vine_a');
    const right = vineOf(sfcSet, 'f1_vine_b');
    let different = 0;
    let visible = 0;
    for (let i = 0; i < left.data.length; i += 4) {
      if (left.data[i + 3] === 0) continue;
      visible++;
      const one = [0, 1, 2].map((c) => quantizeChannel(left.data[i + c]! / 255));
      const other = [0, 1, 2].map((c) => quantizeChannel(right.data[i + c]! / 255));
      if (one.some((value, c) => value !== other[c])) different++;
    }
    // 輪郭の 1 色は共通なので全画素ではない。塗りの大半が別の色であればよい
    expect(different / visible).toBeGreaterThan(0.6);
  });
});
