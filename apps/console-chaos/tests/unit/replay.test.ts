import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadReplay, runReplay } from './replay/harness';

const REPLAY_DIR = join(dirname(fileURLToPath(import.meta.url)), 'replay');
const NAMES = readdirSync(REPLAY_DIR)
  .filter((file) => file.endsWith('.replay.json'))
  .map((file) => file.replace('.replay.json', ''))
  .sort();

interface ReplayGolden {
  replays: Record<string, { sha256: string }>;
}

const GOLDEN = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../golden/replay-state.json'), 'utf8'),
) as ReplayGolden;

describe('リプレイテスト（§7.2、★ パズル 6 件の記録）', () => {
  it('★ の 6 件すべてに記録がある', () => {
    const puzzles = new Set(NAMES.map((name) => loadReplay(name).puzzle));
    expect([...puzzles].sort()).toEqual(['F-1', 'F-2', 'P1-1', 'P1-2', 'P2-1', 'S-1']);
  });

  it('エリア 1 の通し走行が 6 件すべてを解いて終わる（T1-15）', () => {
    const record = loadReplay('area1_full_run');
    const result = runReplay(record);
    expect(result.solvedAll).toEqual(['F-1', 'F-2', 'P1-1', 'P1-2', 'P2-1', 'S-1']);
    expect(result.ticks / 60).toBeLessThan(15 * 60); // 15 分の予算に対する走行時間
  });

  for (const name of NAMES) {
    it(`${name}: 記録どおりに再生される`, () => {
      const record = loadReplay(name);
      const result = runReplay(record);

      expect(result.solved).toBe(record.expect.solved);
      if (record.expect.solvedAll) {
        expect(result.solvedAll).toEqual([...record.expect.solvedAll].sort());
      }
      if (record.expect.solvedAtTick !== undefined) {
        expect(result.solvedAtTick).toBe(record.expect.solvedAtTick);
      }
      if (record.expect.position) {
        const tolerance = record.expect.tolerance ?? 0.001;
        for (let axis = 0; axis < 3; axis++) {
          const actual = result.position[axis] ?? Number.NaN;
          const expected = record.expect.position[axis] ?? Number.NaN;
          expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
        }
      }
    });
  }

  it('同じ入力からは必ず同じ結果になる（不変条件 I4）', () => {
    for (const name of NAMES) {
      const record = loadReplay(name);
      const first = runReplay(record);
      const second = runReplay(record);
      expect(second).toEqual(first);
    }
  });

  it('位置・速度・世代・解決済み puzzle・checkpoint・tick・seed の state hash が基準と一致する', () => {
    expect(Object.keys(GOLDEN.replays).sort()).toEqual(NAMES);
    for (const name of NAMES) {
      const result = runReplay(loadReplay(name));
      const hash = createHash('sha256').update(JSON.stringify(result)).digest('hex');
      expect(hash, name).toBe(GOLDEN.replays[name]?.sha256);
    }
  });

  it('同じ操作で渡り切れるのは第1世代だけ（F-1 は「解ける」より「楽さ」で差が出る）', () => {
    // F-1 は CH 1 / CH 3 / CH 4 で解けるが、**まっすぐ歩くだけで渡れるのは CH 1 だけ**。
    // 3D では細いツタに奥行きを合わせる必要があり、同じ操作では谷へ落ちる（T2-01 の要点）
    const record = loadReplay('f1_braid_walk');
    for (const generation of ['FC', 'SFC', 'PS1', 'PS2'] as const) {
      const result = runReplay({ ...record, generation });
      expect(result.solved, generation).toBe(generation === 'FC');
    }
  });

  it('奥行きを合わせれば第3世代でも渡れる（可不可ではなく難度の差）', () => {
    const thin = runReplay(loadReplay('f1_thin_vine'));
    expect(thin.solved).toBe(true);
    // 同じ部屋を、奥行きを合わせずに歩くと落ちる
    expect(runReplay(loadReplay('f1_thin_vine_fall')).solved).toBe(false);
  });

  it('正解が試行ごとに変わる部屋は、種を記録している（決定 3）', () => {
    for (const name of ['f2_flicker_hint', 'p2_1_torch_walk', 'area1_full_run']) {
      expect(loadReplay(name).seed, name).toBeTypeOf('number');
    }
  });
});
