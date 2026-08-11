import { describe, it, expect } from 'vitest';
import { DISPLAY_NAMES, GENERATION_IDS, PROFILES } from '@/generation/profiles';

describe('generation/profiles（唯一の真実）', () => {
  it('4 世代すべてが定義されている（Record による網羅性）', () => {
    expect(Object.keys(PROFILES).sort()).toEqual([...GENERATION_IDS].sort());
    for (const id of GENERATION_IDS) expect(PROFILES[id].id).toBe(id);
  });

  it('表示名に実機名が含まれない（GAME_PLAN §7.1.1）', () => {
    for (const id of GENERATION_IDS) {
      const { channel, label } = DISPLAY_NAMES[id];
      expect(channel).toMatch(/^CH [1-4]$/);
      expect(label).toMatch(/^第[1-4]世代$/);
      // 内部 ID が表示名に漏れていないこと
      expect(`${channel}${label}`).not.toContain(id);
    }
  });

  it('世代が進むほど制約が緩む（映像）', () => {
    const order = GENERATION_IDS.map((id) => PROFILES[id].video);
    // 内部解像度は単調非減少
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!.internalWidth).toBeGreaterThanOrEqual(order[i - 1]!.internalWidth);
    }
    // 同時発色数: 25 → 256 → 無制限
    expect(order[0]!.maxSimultaneousColors).toBe(25);
    expect(order[1]!.maxSimultaneousColors).toBe(256);
    expect(order[2]!.maxSimultaneousColors).toBe(-1);
    expect(order[3]!.maxSimultaneousColors).toBe(-1);
  });

  it('世代が進むほど同時発音数が増える（5 / 8 / 24 / 48）', () => {
    expect(GENERATION_IDS.map((id) => PROFILES[id].audio.channels)).toEqual([5, 8, 24, 48]);
  });

  it('第1世代だけが斜め移動を禁止する（§4.1 の意図的な差分）', () => {
    expect(PROFILES.FC.input.allowDiagonal).toBe(false);
    expect(PROFILES.FC.input.directional).toBe('dpad4');
    for (const id of ['SFC', 'PS1', 'PS2'] as const) {
      expect(PROFILES[id].input.allowDiagonal).toBe(true);
    }
  });

  it('感圧は第4世代のみ、振動は第3世代以降', () => {
    expect(GENERATION_IDS.map((id) => PROFILES[id].input.pressureSensitive)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(GENERATION_IDS.map((id) => PROFILES[id].input.rumble)).toEqual([false, false, true, true]);
  });

  it('深度バッファを持つのは第4世代のみ（第3世代は描画順で解決する）', () => {
    expect(GENERATION_IDS.map((id) => PROFILES[id].video.depthBuffer)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it('アフィン UV と頂点量子化は第3世代のみ', () => {
    expect(PROFILES.PS1.video.affineTexture).toBe(true);
    expect(PROFILES.PS1.video.vertexQuantize).toBeGreaterThan(0);
    for (const id of ['FC', 'SFC', 'PS2'] as const) {
      expect(PROFILES[id].video.affineTexture).toBe(false);
      expect(PROFILES[id].video.vertexQuantize).toBe(0);
    }
  });

  it('能力の総量が等価になっている（得るものと失うものがペア：§5.3）', () => {
    // 第1世代は移動が粗い（4 方向・スナップあり）代わりに、正確に止まれる
    expect(PROFILES.FC.action.moveSnap).toBeGreaterThan(0);
    expect(PROFILES.FC.action.fineControl).toBe(false);
    // 第3世代以降はアナログで微調整できる代わりに、正確な停止位置は保証されない
    for (const id of ['PS1', 'PS2'] as const) {
      expect(PROFILES[id].action.moveSnap).toBe(0);
      expect(PROFILES[id].action.fineControl).toBe(true);
    }
  });

  it('ボーンアニメの再生レートが世代ごとに定義されている（コマ落ちの表現）', () => {
    expect(GENERATION_IDS.map((id) => PROFILES[id].video.animationHz)).toEqual([6, 12, 30, 60]);
  });

  it('背後からの視点を持つのは第4世代のみ（他は真横から見る）', () => {
    // 真横から見る構図の視線は奥（-Z）。背後視点だけが通路の進行方向（+X）を向く
    for (const id of ['FC', 'SFC', 'PS1'] as const) {
      expect(PROFILES[id].camera.forward, id).toEqual([0, -1]);
    }
    expect(PROFILES.PS2.camera.forward).toEqual([1, 0]);
  });

  it('カメラの向きは正規化されている（移動の基底にも使うため）', () => {
    for (const id of GENERATION_IDS) {
      const [x, z] = PROFILES[id].camera.forward;
      expect(Math.hypot(x, z), id).toBeCloseTo(1, 12);
    }
  });

  it('2D の 2 世代は絵で描かれ、3D の 2 世代はモデルで描かれる（T2-09 / T2-11）', () => {
    // 世代の差は「密度が上がる」だけでなく「何でできているか」まで届く。
    // 正射影で深度も動的ライティングも持たない 2 世代は絵、3D の 2 世代は骨とポリゴン
    expect(GENERATION_IDS.map((id) => PROFILES[id].player.kind)).toEqual([
      'sprite',
      'sprite',
      'model',
      'model',
    ]);
    // 絵の世代は正射影、モデルの世代は透視投影。上の並びと一致していること
    expect(GENERATION_IDS.map((id) => PROFILES[id].video.projection)).toEqual([
      'ortho2d',
      'ortho2d',
      'perspective3d',
      'perspective3d',
    ]);
  });

  it('世代ごとに別のアトラスを指す（絵を共有しない。T2-11）', () => {
    const files = GENERATION_IDS.map((id) => {
      const player = PROFILES[id].player;
      return player.kind === 'sprite' ? player.file : null;
    });
    expect(files).toEqual(['hero_gen1.png', 'hero_gen2.png', null, null]);
  });

  it('外部アセットのモデルは正面が +Z（第3・第4世代）', () => {
    const fronts = GENERATION_IDS.map((id) => {
      const player = PROFILES[id].player;
      return player.kind === 'model' ? player.front : null;
    });
    expect(fronts).toEqual([null, null, '+Z', '+Z']);
  });

  it('第3世代のカメラは見下ろし角を変えずに距離だけを詰めた（T2-08 → BR-04）', () => {
    // 画角は 55° 固定（render/camera.ts）なので、**大きさは距離だけで決まる**。
    // T2-08 の 4.5 をさらに 1.5 で割り、キャラクタが 1.5 倍の大きさで映るようにした
    expect(PROFILES.PS1.camera.distance).toBeCloseTo(4.5 / 1.5, 6);
    // 角度の比は動かさない（改訂前の 9 / 3.2 という構図の判断はそのまま）
    expect(PROFILES.PS1.camera.height / PROFILES.PS1.camera.distance).toBeCloseTo(3.2 / 9, 4);
  });

  it('第4世代だけが注視点をプレイヤーより十分に前へ置く（奥へ進む画）', () => {
    expect(PROFILES.PS2.camera.lookAhead).toBeGreaterThan(PROFILES.PS2.camera.distance);
    for (const id of ['FC', 'SFC', 'PS1'] as const) {
      expect(PROFILES[id].camera.lookAhead).toBeLessThan(PROFILES[id].camera.distance);
    }
  });

  it('パレットのブロック制限を持つのは 2D 世代のみ', () => {
    expect(PROFILES.FC.video.paletteBlockSize).toBe(16);
    expect(PROFILES.SFC.video.paletteBlockSize).toBe(8);
    expect(PROFILES.PS1.video.paletteBlockSize).toBe(0);
    expect(PROFILES.PS2.video.paletteBlockSize).toBe(0);
  });

  it('プロファイルは定数であり、関数を含まない（ロジックを持たない）', () => {
    const walk = (value: unknown): void => {
      if (typeof value === 'function') throw new Error('プロファイルに関数が含まれている');
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    expect(() => walk(PROFILES)).not.toThrow();
  });
});
