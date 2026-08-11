import { describe, it, expect } from 'vitest';
import { applyScanlineLimit, createFlickerState, type SpriteDrawItem } from '@/render/sprite_limit';
import { PROFILES } from '@/generation/profiles';

const SCREEN_HEIGHT = 224;

/** 同じ走査線に並ぶスプライト群を作る。先頭が最優先（OAM 順） */
function row(count: number, y = 100, height = 8): SpriteDrawItem[] {
  return Array.from({ length: count }, (_, i) => ({ entity: i, y, height }));
}

describe('FC 走査線スプライト制限（V5）', () => {
  it('上限までは表示され、9 個目以降が破棄される', () => {
    const limit = PROFILES.FC.video.spritesPerScanline;
    expect(limit).toBe(8);

    const { visible, culled } = applyScanlineLimit(row(12), limit, SCREEN_HEIGHT);
    expect(visible).toHaveLength(8);
    expect(culled).toEqual([8, 9, 10, 11]);
  });

  it('優先順位は登録順（プレイヤーを先頭に登録すれば消えない）', () => {
    const player: SpriteDrawItem = { entity: 999, y: 100, height: 16 };
    const others = row(20).map((s) => ({ ...s, entity: s.entity + 1 }));
    const { visible, culled } = applyScanlineLimit([player, ...others], 8, SCREEN_HEIGHT);

    expect(visible[0]?.entity).toBe(999);
    expect(culled).not.toContain(999);
  });

  it('走査線が違えば影響しない', () => {
    const upper = row(8, 20);
    const lower = row(8, 120).map((s) => ({ ...s, entity: s.entity + 100 }));
    const { visible, culled } = applyScanlineLimit([...upper, ...lower], 8, SCREEN_HEIGHT);
    expect(visible).toHaveLength(16);
    expect(culled).toEqual([]);
  });

  it('縦に長いスプライトは、覆うすべての走査線を消費する', () => {
    // 高さ 32 のスプライト 8 枚で y=100..132 を埋める
    const tall = row(8, 100, 32);
    // その範囲に重なる小さなスプライトは入れない
    const small: SpriteDrawItem = { entity: 50, y: 130, height: 8 };
    // 範囲外なら入る
    const outside: SpriteDrawItem = { entity: 51, y: 140, height: 8 };

    const { visible, culled } = applyScanlineLimit([...tall, small, outside], 8, SCREEN_HEIGHT);
    expect(culled).toEqual([50]);
    expect(visible.map((s) => s.entity)).toContain(51);
  });

  it('上限が 0 以下なら「制限なし」（第3・第4世代は -1）', () => {
    expect(PROFILES.PS1.video.spritesPerScanline).toBe(-1);
    const { visible, culled } = applyScanlineLimit(row(100), -1, SCREEN_HEIGHT);
    expect(visible).toHaveLength(100);
    expect(culled).toEqual([]);
  });

  it('第2世代は上限が緩い（同じ規則で値だけが違う）', () => {
    const limit = PROFILES.SFC.video.spritesPerScanline;
    expect(limit).toBe(32);
    const { culled } = applyScanlineLimit(row(32), limit, SCREEN_HEIGHT);
    expect(culled).toEqual([]);
  });

  it('画面外のスプライトは制限を消費しない', () => {
    const offscreen: SpriteDrawItem[] = [
      { entity: 1, y: -40, height: 8 },
      { entity: 2, y: 400, height: 8 },
    ];
    const onscreen = row(8, 100).map((s) => ({ ...s, entity: s.entity + 10 }));
    const { culled } = applyScanlineLimit([...offscreen, ...onscreen], 8, SCREEN_HEIGHT);
    expect(culled).toEqual([]);
  });

  it('同じ入力なら常に同じ結果（決定的：不変条件 I4）', () => {
    const sprites = row(30, 60, 12);
    const a = applyScanlineLimit(sprites, 8, SCREEN_HEIGHT);
    const b = applyScanlineLimit(sprites, 8, SCREEN_HEIGHT);
    expect(b.culled).toEqual(a.culled);
    expect(b.visible.map((s) => s.entity)).toEqual(a.visible.map((s) => s.entity));
  });

  it('カウンタ配列を渡せば毎フレームのアロケーションを避けられる', () => {
    const counters = new Int32Array(SCREEN_HEIGHT);
    const sprites = row(12);
    const first = applyScanlineLimit(sprites, 8, SCREEN_HEIGHT, counters);
    const second = applyScanlineLimit(sprites, 8, SCREEN_HEIGHT, counters);
    expect(second.culled).toEqual(first.culled);
  });
});

describe('破棄結果の 1 ティック遅延（§4.4）', () => {
  it('描画で破棄されたエンティティは、次ティックの当たり判定で無効になる', () => {
    const flicker = createFlickerState();
    expect(flicker.state.culled.size).toBe(0);

    // ティック N の描画で 8,9 が消えた
    const { culled } = applyScanlineLimit(row(10), 8, SCREEN_HEIGHT);
    flicker.commit(culled);

    // ティック N+1 の衝突判定はこれを参照する
    expect(flicker.state.culled.has(8)).toBe(true);
    expect(flicker.state.culled.has(9)).toBe(true);
    expect(flicker.state.culled.has(0)).toBe(false);
  });

  it('次のフレームで表示が戻れば無効化も解除される', () => {
    const flicker = createFlickerState();
    flicker.commit(applyScanlineLimit(row(10), 8, SCREEN_HEIGHT).culled);
    expect(flicker.state.culled.size).toBe(2);

    flicker.commit(applyScanlineLimit(row(4), 8, SCREEN_HEIGHT).culled);
    expect(flicker.state.culled.size).toBe(0);
  });
});
