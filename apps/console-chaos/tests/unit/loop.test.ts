import { describe, it, expect } from 'vitest';
import { createLoop, MAX_CATCHUP_TICKS, TICK_MS, type LoopHost } from '@console-chaos/engine';

interface Harness {
  loop: ReturnType<typeof createLoop>;
  ticks: number[];
  renders: Array<{ alpha: number; dtMs: number }>;
  hidden: { value: boolean };
}

function harness(): Harness {
  const ticks: number[] = [];
  const renders: Array<{ alpha: number; dtMs: number }> = [];
  const hidden = { value: false };
  const host: LoopHost = {
    now: () => 0,
    requestFrame: () => 0,
    cancelFrame: () => {},
    isHidden: () => hidden.value,
  };
  const loop = createLoop(
    {
      tick: (i) => ticks.push(i),
      render: (alpha, dtMs) => renders.push({ alpha, dtMs }),
    },
    host,
  );
  return { loop, ticks, renders, hidden };
}

describe('createLoop', () => {
  it('初回フレームはティックを進めない（基準時刻の確定のみ）', () => {
    const h = harness();
    expect(h.loop.frame(0)).toBe(0);
    expect(h.ticks).toEqual([]);
    expect(h.renders).toHaveLength(1);
  });

  it('60fps で 1 フレームあたり 1 ティック進む', () => {
    const h = harness();
    h.loop.frame(0);
    for (let i = 1; i <= 60; i++) h.loop.frame(i * TICK_MS);
    expect(h.loop.time.tick).toBe(60);
    expect(h.ticks[0]).toBe(0);
    expect(h.ticks.at(-1)).toBe(59);
  });

  it('描画が半分の頻度でもティック数は実時間どおり（不変条件 I3）', () => {
    const fast = harness();
    fast.loop.frame(0);
    for (let i = 1; i <= 120; i++) fast.loop.frame(i * TICK_MS); // 120fps 相当の呼び出し

    const slow = harness();
    slow.loop.frame(0);
    for (let i = 1; i <= 60; i++) slow.loop.frame(i * TICK_MS * 2); // 30fps 相当

    // 同じ 2 秒間なら、描画頻度が違ってもティック数は一致する
    expect(fast.loop.time.tick).toBe(120);
    expect(slow.loop.time.tick).toBe(120);
  });

  it('30fps 描画では 1 フレームに 2 ティック進む', () => {
    const h = harness();
    h.loop.frame(0);
    const ticked = h.loop.frame(TICK_MS * 2);
    expect(ticked).toBe(2);
  });

  it('フレーム落ち（スパイク）で MAX_CATCHUP_TICKS を超える分は切り捨てる', () => {
    const h = harness();
    h.loop.frame(0);
    // 500ms のスパイク = 30 ティック分。上限 5 ティックまでしか消化しない
    const ticked = h.loop.frame(500);
    expect(ticked).toBe(MAX_CATCHUP_TICKS);
    expect(h.loop.time.tick).toBe(MAX_CATCHUP_TICKS);
    expect(h.loop.time.droppedTicks).toBeGreaterThan(0);
  });

  it('スパイク後もティック間隔は固定のまま（時間を飛ばすだけ）', () => {
    const h = harness();
    h.loop.frame(0);
    h.loop.frame(500);
    const before = h.loop.time.tick;
    h.loop.frame(500 + TICK_MS);
    expect(h.loop.time.tick).toBe(before + 1);
  });

  it('非表示の間はティックを進めず、復帰時に時間が積み上がらない', () => {
    const h = harness();
    h.loop.frame(0);
    h.hidden.value = true;
    h.loop.frame(TICK_MS);
    h.loop.frame(10_000); // 10 秒間バックグラウンド
    expect(h.loop.time.tick).toBe(0);

    h.hidden.value = false;
    h.loop.frame(10_000 + TICK_MS); // 復帰直後のフレームは基準の取り直し
    expect(h.loop.time.tick).toBe(0);
    h.loop.frame(10_000 + TICK_MS * 2);
    expect(h.loop.time.tick).toBe(1);
  });

  it('alpha は常に 0..1 未満で、端数がそのまま出る', () => {
    const h = harness();
    h.loop.frame(0);
    h.loop.frame(TICK_MS * 1.5);
    const last = h.renders.at(-1);
    expect(last?.alpha).toBeCloseTo(0.5, 6);
    for (const r of h.renders) {
      expect(r.alpha).toBeGreaterThanOrEqual(0);
      expect(r.alpha).toBeLessThan(1);
    }
  });

  it('端数の累積でティックが失われない（59.94Hz 相当の入力）', () => {
    const h = harness();
    h.loop.frame(0);
    const frameMs = 1000 / 59.94;
    for (let i = 1; i <= 599; i++) h.loop.frame(i * frameMs);
    const elapsed = 599 * frameMs;
    expect(h.loop.time.tick).toBe(Math.floor(elapsed / TICK_MS));
  });

  it('tick に渡るインデックスは連番', () => {
    const h = harness();
    h.loop.frame(0);
    for (let i = 1; i <= 10; i++) h.loop.frame(i * TICK_MS * 1.7);
    h.ticks.forEach((t, i) => expect(t).toBe(i));
  });
});
