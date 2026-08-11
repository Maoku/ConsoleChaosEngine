/**
 * 背景のゴールデン（KV-02、計画 §5）。
 *
 * 絵の良し悪しは機械で見られないが、**壊れたことは機械で見られる**。
 * ここが固定するのは「4 世代の背景色」そのもので、
 * 落ちたときの意味は「背景の世代差が消えた」＝今回の改修の主目的が壊れた、である。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../../tools/png';
import { GENERATION_IDS, PROFILES, type GenerationId } from '@/generation/profiles';
import { PIXELS_PER_WORLD_UNIT } from '@/level/schema';
import { FC_PALETTE, KEY_COLORS } from '@/render/key_palette';
import { MATERIALS } from '@/render/material';
import { nearestMasterIndex } from '@/render/quantize/master_palette';

/**
 * その世代の画面がワールドで占める大きさ（m）。**背景の速さはすべてこれを基準に決まる**
 *（BR-01 の決定 1）。2D 世代は横 8m・縦 7m。
 */
function screenSpan(id: GenerationId): { width: number; height: number } {
  const { internalWidth, internalHeight } = PROFILES[id].video;
  return {
    width: internalWidth / PIXELS_PER_WORLD_UNIT,
    height: internalHeight / PIXELS_PER_WORLD_UNIT,
  };
}

/** 床と同じ速さで流れるときの `scroll`（UV / m）。層が画面幅あたり repeat 周するので */
function groundScroll(id: GenerationId, repeat: number): number {
  return repeat / screenSpan(id).width;
}

/** 床と同じ速さで上下するときの `scrollY`（画面比 / m） */
function groundScrollY(id: GenerationId): number {
  return 1 / screenSpan(id).height;
}

/** 背景の代表色（上端と下端の平均）。世代差を 1 つの値で比べるために使う */
function meanSky(id: GenerationId): [number, number, number] {
  const [top, bottom] = PROFILES[id].art.backdrop.sky;
  return [0, 1, 2].map((c) => Math.round((top[c]! + bottom[c]!) / 2)) as [number, number, number];
}

function luma([r, g, b]: readonly number[]): number {
  return 0.299 * r! + 0.587 * g! + 0.114 * b!;
}

/** 遠景の層に実際に置かれている色（透明な画素は数えない） */
function farLayerColors(id: GenerationId): Array<[number, number, number]> {
  const { textureSet, backdrop } = PROFILES[id].art;
  const layer = backdrop.far;
  if (!layer) return [];
  const image = decodePng(readFileSync(join('public/assets/textures', textureSet, layer.texture)));
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] === 0) continue;
    const rgb: [number, number, number] = [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!];
    seen.set(rgb.join(','), rgb);
  }
  return [...seen.values()];
}

/** 遠景の層のうち、完全に透明な画素の割合（0..1）。「敷き詰めていない」を数で見る */
function farLayerTransparency(id: GenerationId): number {
  const { textureSet, backdrop } = PROFILES[id].art;
  const layer = backdrop.far!;
  const image = decodePng(readFileSync(join('public/assets/textures', textureSet, layer.texture)));
  let clear = 0;
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] === 0) clear++;
  return clear / (image.width * image.height);
}

describe('背景のゴールデン（KV-02）', () => {
  it('4 世代の空の色を数値で固定する', () => {
    // SG-02 / SG-03：第1世代は固定 54 色の空色 1 色、第3世代は「最遠のメサ」＝
    // 遠いものが溶けていく先の 1 色。どちらも上下で色を変えない
    expect(PROFILES.FC.art.backdrop.sky).toEqual([
      [0x48, 0x98, 0xe8],
      [0x48, 0x98, 0xe8],
    ]);
    expect(PROFILES.SFC.art.backdrop.sky).toEqual([
      [0x10, 0x70, 0xe0],
      [0x68, 0xc0, 0xf8],
    ]);
    expect(PROFILES.PS1.art.backdrop.sky).toEqual([
      [0x78, 0x86, 0xaa],
      [0x78, 0x86, 0xaa],
    ]);
    expect(PROFILES.PS2.art.backdrop.sky).toEqual([
      [0x15, 0x74, 0xe5],
      [0x69, 0xc4, 0xfd],
    ]);
  });

  it('4 世代とも昼の空になっている（SG-03）', () => {
    // **同じ 1 つの場所を 4 通りの出し方で見せる**（上位計画 §3 の決定 3）。
    // 「夜の街」「紅紫の空」のような**場所の差**へ戻っていないことを見る。
    // 昼かどうかは空の明度で測る（夜の深紺は明度 20 前後だった）
    for (const id of GENERATION_IDS) {
      const top = luma(PROFILES[id].art.backdrop.sky[0]);
      expect(top, `${id} の空の上端`).toBeGreaterThan(90);
    }
  });

  it('どの世代の背景も黒ではない（基準画 F「どこにも黒が無い」）', () => {
    for (const id of GENERATION_IDS) {
      for (const color of PROFILES[id].art.backdrop.sky) {
        expect(Math.max(...color), `${id} の空`).toBeGreaterThan(0);
      }
    }
  });

  it('4 世代の背景色が互いに異なる', () => {
    const seen = GENERATION_IDS.map((id) => meanSky(id).join(','));
    expect(new Set(seen).size).toBe(GENERATION_IDS.length);
  });

  it('背景の層は世代あたり最大 2 枚（レイヤシステムを作らない）', () => {
    for (const id of GENERATION_IDS) {
      const { far, near } = PROFILES[id].art.backdrop;
      // 型の上でも 2 枚だが、「近景だけを持つ」状態は層の順序が意味を失うので禁じる
      if (near !== null) expect(far, `${id}`).not.toBeNull();
    }
  });

  it('第1世代の背景は固定 54 色の表に載っている色だけを使う', () => {
    const allowed = new Set(FC_PALETTE.map((color) => color.source.join(',')));
    for (const color of PROFILES.FC.art.backdrop.sky) {
      expect(allowed, `[${color.join(',')}]`).toContain(color.join(','));
    }
  });

  it('世代ごとにテクスチャセットが分かれている（KV-03）', () => {
    const sets = GENERATION_IDS.map((id) => PROFILES[id].art.textureSet);
    expect(new Set(sets).size).toBe(GENERATION_IDS.length);
  });
});

describe('第1世代：固定 54 色の昼（KV-04 / SG-03）', () => {
  it('背景が固定 54 色の 3 色 + 画面共通の背景色に収まる', () => {
    // 実機の属性ブロックは 16×16 につき 3 色 + 背景色。**背景だけで使い切ってはいけない**
    //（使い切ると足場もプレイヤーも色を持てなくなる）
    const indices = new Set<number>();
    for (const color of PROFILES.FC.art.backdrop.sky) {
      indices.add(nearestMasterIndex(color[0], color[1], color[2]));
    }
    for (const color of farLayerColors('FC')) {
      indices.add(nearestMasterIndex(color[0], color[1], color[2]));
    }
    expect([...indices].length, `使った番号: ${[...indices].join(',')}`).toBeLessThanOrEqual(4);
  });

  it('背景の色がすべて第1世代の 7 色の宣言に載っている', () => {
    const declared = new Set(FC_PALETTE.map((color) => color.index));
    for (const color of farLayerColors('FC')) {
      const index = nearestMasterIndex(color[0], color[1], color[2]);
      expect(declared, `rgb(${color.join(',')}) → ${index} 番`).toContain(index);
    }
  });

  it('空は上下で色を変えない（グラデーションはブロックの色数を食う）', () => {
    const [top, bottom] = PROFILES.FC.art.backdrop.sky;
    expect(top).toEqual(bottom);
  });

  it('遠景は床とまったく同じ速さで流れる（横も縦も。BR-01）', () => {
    // 第1世代の背景は多重スクロールを持たない。**世界そのものと同じ面**である、
    // という宣言がこの 2 行で、ズレていれば「床と背景が別々に動く」に戻る
    const far = PROFILES.FC.art.backdrop.far!;
    expect(far.scroll).toBeCloseTo(groundScroll('FC', far.repeat), 6);
    expect(far.scrollY).toBeCloseTo(groundScrollY('FC'), 3);
  });

  it('遠景の下端がワールドの y = 0 の面に乗る（メサが地面に立って見える）', () => {
    // 画面上での y=0 の位置は `0.5 - カメラY / 7`。層の下端は `bottom - カメラY × scrollY`。
    // この 2 つが同じ式になるとき、背景は世界と同じ面に立つ。
    // 画面で確かめたとおり、bottom が 0.5 でないと遠景が床より下へ沈む
    const far = PROFILES.FC.art.backdrop.far!;
    expect(far.bottom).toBe(0.5);
    expect(far.scrollY).toBeCloseTo(groundScrollY('FC'), 3);
  });

  it('遠景は敷き詰めない（地平の向こうに空が抜ける）', () => {
    // 改訂前は幅 128 の中に奥 4 桁 + 手前 8 桁を隙間なく並べており、
    // repeat 3 で敷かれた結果、地平が端から端まで建物で埋まっていた。
    // SG-01 の gen1 写像が**アルファを一切触らない**ことで、この 52.6% が保たれている（W-3）
    expect(farLayerTransparency('FC')).toBeGreaterThan(0.5);
  });
});

describe('第2世代：多重スクロール（KV-05）', () => {
  it('層を 2 枚持つのは第2世代だけ', () => {
    for (const id of GENERATION_IDS) {
      const { far, near } = PROFILES[id].art.backdrop;
      const layers = [far, near].filter((layer) => layer !== null).length;
      expect(layers, id).toBe(id === 'SFC' ? 2 : 1);
    }
  });

  it('2 枚は別々の速さで流れる（同じ速さなら層を分ける意味が無い）', () => {
    const { far, near } = PROFILES.SFC.art.backdrop;
    expect(far!.scroll).not.toBe(near!.scroll);
    // 手前ほど速い。逆にすると奥行きが反転して見える
    expect(near!.scroll).toBeGreaterThan(far!.scroll);
  });

  it('空が縦のグラデーションを持つ（色数の制限が無い世代の署名）', () => {
    const [top, bottom] = PROFILES.SFC.art.backdrop.sky;
    expect(top).not.toEqual(bottom);
  });

  it('2 層の速度比が 5 倍以上ある（横も縦も。BR-02）', () => {
    // 改訂前は 3.4 倍しかなく、横に歩いても層が分離せず「多重スクロール」として読めなかった
    const { far, near } = PROFILES.SFC.art.backdrop;
    expect(near!.scroll / far!.scroll).toBeGreaterThanOrEqual(5);
    expect(near!.scrollY / far!.scrollY).toBeGreaterThanOrEqual(5);
  });

  it('どちらの層も床より遅い（背景が世界を追い越さない）', () => {
    const { far, near } = PROFILES.SFC.art.backdrop;
    for (const layer of [far!, near!]) {
      expect(layer.scroll).toBeLessThan(groundScroll('SFC', layer.repeat));
      expect(layer.scrollY).toBeLessThan(groundScrollY('SFC'));
    }
  });
});

describe('2D 世代の背景の骨格（BR-01 / BR-02）', () => {
  it('縦のスクロールを持つのは第1・第2世代だけ', () => {
    // ジャンプで背景が縦にも動くのは 2D 世代の署名。3D の 2 世代へ漏らさない
    for (const id of GENERATION_IDS) {
      const layers = [PROFILES[id].art.backdrop.far, PROFILES[id].art.backdrop.near].filter(
        (layer) => layer !== null,
      );
      const moves = layers.some((layer) => layer.scrollY > 0);
      expect(moves, id).toBe(PROFILES[id].video.projection === 'ortho2d');
    }
  });

  it('2D 世代の層はテクセルが画面画素と 1:1（拡大縮小の滲みが出ない）', () => {
    for (const id of GENERATION_IDS) {
      if (PROFILES[id].video.projection !== 'ortho2d') continue;
      const { textureSet, backdrop } = PROFILES[id].art;
      for (const layer of [backdrop.far, backdrop.near]) {
        if (!layer) continue;
        const image = decodePng(readFileSync(join('public/assets/textures', textureSet, layer.texture)));
        expect(layer.repeat * image.width, `${id} / ${layer.texture}`).toBe(
          PROFILES[id].video.internalWidth,
        );
      }
    }
  });
});

describe('第3世代：遠くの霧（KV-06）', () => {
  it('霧を持つのは第3世代だけ', () => {
    for (const id of GENERATION_IDS) {
      expect(PROFILES[id].art.fogDensity > 0, id).toBe(id === 'PS1');
    }
  });

  it('霧の濃さは 40m 先でほぼ抜けきる（遠景が背景色になる）', () => {
    // シェーダは 1 - exp(-距離 × 濃さ)。カメラから 40m での混ざり具合を見る
    const density = PROFILES.PS1.art.fogDensity;
    expect(1 - Math.exp(-40 * density)).toBeGreaterThan(0.7);
    // 5m 先ではほとんど掛からない（手前の造形まで溶けたら形が読めない）
    expect(1 - Math.exp(-5 * density)).toBeLessThan(0.25);
  });
});

describe('第4世代：基準画そのままの昼（KV-07 / SG-03）', () => {
  // SG-03 で 2 件を廃止した（理由は Docs/measurements/SG-03_sky.md §3）。
  //   - 「背景は第3世代より暗い」→ 4 世代とも昼になったので、暗さでは世代差を測れない。
  //     第4世代の署名は SG-09 の「落ち影を落とすのはこの世代だけ」が引き継ぐ
  //   - 「遠景に空よりはっきり明るい窓がある」→ 遠景が街からメサへ変わり、窓が無くなった。
  //     「画面でいちばん明るいもの」は SG-10 の門の光が引き継ぐ

  it('落ち影を落とすのは第4世代だけ（SG-03 で外した「暗い」の置き換え）', () => {
    // **世代 ID は書かない。** 見るのは `video.dynamicLight` が真な世代とちょうど一致すること。
    // 4 世代とも昼になった以上、第4世代の署名は暗さではなく**影**が担う（SG-09）。
    // 影を落とすかどうかは材質が決め、動く光を持つ世代でだけ効く
    const casters = Object.values(MATERIALS).filter((material) => material.castShadow);
    expect(casters.length, '影を落とす材質が 1 つも無い').toBeGreaterThan(0);
    const withLight = GENERATION_IDS.filter((id) => PROFILES[id].video.dynamicLight);
    expect(withLight).toEqual(['PS2']);
  });

  it('環境光は色を持つが、明度は材質の値のまま（SG-09 の判断 G）', () => {
    // **明度で正規化するのが要点。** 正規化しないと `ambient` の意味が世代ごとに変わり、
    // 暗室（P2-1、ambient 0.05）の明るさまで空の色で動いてしまう
    const renderer = readFileSync('src/render/renderer3d.ts', 'utf8');
    expect(renderer).toMatch(/horizon\[c\]! \/ skyLuma/);
    // 空の見えない部屋では**色だけ**が無彩色へ戻る（取り分は 0 にしない）
    expect(renderer).toMatch(/1 \+ \(\(horizon\[c\]! \/ skyLuma\) - 1\) \* tint/);
    for (const id of GENERATION_IDS) {
      const tint = PROFILES[id].art.backdrop.sky[1];
      expect(luma(tint), `${id} の空の下端が黒い（0 で割ることになる）`).toBeGreaterThan(0);
    }
  });

  it('空を実測値のまま出せるのはこの世代だけ（丸めも代用もしない）', () => {
    // 第1世代は固定 54 色へ、第2世代は RGB555 へ丸まる。第3世代は色が乏しい。
    // **同じ空を見ているのに 4 通りに割れる**ことがこの計画の芯（上位計画 §1.2）
    expect(PROFILES.PS2.art.backdrop.sky[0]).toEqual([...KEY_COLORS.skyDay]);
    expect(PROFILES.PS2.art.backdrop.sky[1]).toEqual([...KEY_COLORS.skyHorizon]);
    const others = GENERATION_IDS.filter((id) => id !== 'PS2');
    for (const id of others) {
      expect(PROFILES[id].art.backdrop.sky[0], `${id}`).not.toEqual([...KEY_COLORS.skyDay]);
    }
  });

  it('門の光が 4 セットとも画面でいちばん明るい帯にいる（SG-10）', () => {
    // SG-03 で外した「遠景に空より 120 以上明るい窓がある」の置き換え。
    // **120 という差は使えない。** 4 世代とも昼になり、空そのものが明度 133〜175 になったので、
    // 固定 54 色の上限（255）から引いても 120 は出ない（第1世代の実測 110.8）。
    // 意図（画面のどこかに空より圧倒的に明るいものがある）は明度の絶対値で守る
    for (const id of GENERATION_IDS) {
      const set = PROFILES[id].art.textureSet;
      const image = decodePng(readFileSync(join('public/assets/textures', set, 'gate_glow.png')));
      const seen = new Set<string>();
      for (let i = 0; i < image.data.length; i += 4) {
        if (image.data[i + 3] === 0) continue;
        seen.add(`${image.data[i]},${image.data[i + 1]},${image.data[i + 2]}`);
      }
      const brightest = Math.max(...[...seen].map((key) => luma(key.split(',').map(Number))));
      const sky = Math.max(...PROFILES[id].art.backdrop.sky.map(luma));
      expect(brightest, `${id} の門の光`).toBeGreaterThanOrEqual(200);
      expect(brightest - sky, `${id} の門と空の差`).toBeGreaterThan(60);
    }
    // 門は光そのものなので陰影を受けない。受けると中心の白が 5 段で沈み、
    // 「画面でいちばん明るいもの」でなくなる
    expect(MATERIALS['goal']!.diffuse).toBe(0);
    expect(MATERIALS['goal']!.ambient).toBe(1);
    expect(MATERIALS['goal']!.texture).toBe('gate_glow.png');
  });

  it('第3世代の遠景には、そこまで明るい色が無い（色が乏しいことが第3世代の姿）', () => {
    const sky = luma(PROFILES.PS1.art.backdrop.sky[0]);
    const brightest = Math.max(...farLayerColors('PS1').map(luma));
    expect(brightest - sky).toBeLessThan(40);
  });
});
