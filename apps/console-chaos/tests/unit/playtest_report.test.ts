/**
 * 試遊記録の集計（T1-20）の検証。
 *
 * **ゲート G1-3 の合否をこの計算が決める**ので、閾値の周りを固定しておく。
 */
import { describe, it, expect } from 'vitest';
import {
  compare,
  differenceRatio,
  durations,
  explainedRatio,
  median,
  report,
  DIFFERENCE_THRESHOLD,
  type PlaytestRecord,
} from '../../tools/playtest-report';

function record(
  tester: string,
  device: string,
  solvedAt: ReadonlyArray<number | null>,
  hints: readonly number[] = [],
): PlaytestRecord {
  const ids = ['F-1', 'F-2', 'S-1', 'P1-1', 'P1-2', 'P2-1'];
  return {
    levelId: 'area1',
    tester,
    startedAt: '2026-08-02T10:00:00.000Z',
    device,
    elapsedSeconds: 900,
    cleared: solvedAt.every((value) => value !== null),
    puzzles: ids.map((puzzleId, index) => ({
      puzzleId,
      solvedAtSeconds: solvedAt[index] ?? null,
      hintStage: hints[index] ?? 0,
    })),
    solvedCount: solvedAt.filter((value) => value !== null).length,
    respawnCount: 4,
    switchCount: 20,
  };
}

describe('tools/playtest-report', () => {
  it('所要時間は「解いた時刻の差分」で出す（配置順ではなく解いた順）', () => {
    // P1-1 を先に解き、そのあと F-1 を解いた人
    const solved = durations(record('01', 'keyboard', [300, null, null, 100, null, null]));
    expect(solved.get('P1-1')).toBe(100);
    expect(solved.get('F-1')).toBe(200);
    expect(solved.has('F-2')).toBe(false);
  });

  it('中央値は偶数件で真ん中 2 つの平均', () => {
    expect(median([10, 20, 30])).toBe(20);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([])).toBeNull();
  });

  it('差の割合は遅い側を分母にする', () => {
    expect(differenceRatio(50, 100)).toBe(0.5);
    expect(differenceRatio(100, 100)).toBe(0);
    expect(differenceRatio(null, 100)).toBeNull();
  });

  it('閾値ちょうどでは差ありにしない（超えたときだけ）', () => {
    // キーボード 100 秒 / パッド 50 秒 → 差はちょうど 50%
    const borderline = compare([
      record('01', 'keyboard', [100, null, null, null, null, null]),
      record('02', 'gamepad', [50, null, null, null, null, null]),
    ]);
    expect(borderline[0]!.ratio).toBe(DIFFERENCE_THRESHOLD);
    expect(borderline[0]!.flagged).toBe(false);

    const over = compare([
      record('01', 'keyboard', [100, null, null, null, null, null]),
      record('02', 'gamepad', [40, null, null, null, null, null]),
    ]);
    expect(over[0]!.flagged).toBe(true);
  });

  it('片方のデバイスしか居なければ比較しない', () => {
    const rows = compare([record('01', 'keyboard', [100, null, null, null, null, null])]);
    expect(rows[0]!.ratio).toBeNull();
    expect(rows[0]!.flagged).toBe(false);
    expect(report([record('01', 'keyboard', [100, null, null, null, null, null])])).toContain('比較できない');
  });

  it('mixed / unknown は比較から外れるが、人数としては数える', () => {
    const records = [
      record('01', 'keyboard', [100, null, null, null, null, null]),
      record('02', 'gamepad', [110, null, null, null, null, null]),
      record('03', 'mixed', [500, null, null, null, null, null]),
    ];
    const rows = compare(records);
    expect(rows[0]!.keyboardMedian).toBe(100);
    expect(rows[0]!.gamepadMedian).toBe(110);
    expect(rows[0]!.solvedBy).toBe(3);
    expect(report(records)).toContain('判別できず 1 名');
  });

  it('差が閾値内なら G1-3 通過と書く', () => {
    const text = report([
      record('01', 'keyboard', [100, 200, 300, 400, 500, 600]),
      record('02', 'gamepad', [110, 210, 320, 430, 540, 650]),
    ]);
    expect(text).toContain('G1-3 は通過');
    expect(text).not.toContain('⚠');
  });

  it('ヒント段階 3 以上に偏るパズルを名指しする', () => {
    const text = report([
      record('01', 'keyboard', [100, 200, 300, 400, 500, 600], [0, 0, 0, 3, 0, 0]),
      record('02', 'gamepad', [110, 210, 320, 430, 540, 650], [0, 0, 0, 4, 0, 0]),
    ]);
    expect(text).toContain('ヒント段階 3 以上に偏るパズル: P1-1');
  });
});

describe('説明できたかの集計（T1-28）', () => {
  const record = (tester: string, values: Array<boolean | null>): PlaytestRecord => ({
    levelId: 'area1',
    tester,
    startedAt: `2026-08-10T10:0${tester}:00.000Z`,
    device: 'keyboard',
    elapsedSeconds: 600,
    cleared: true,
    solvedCount: 2,
    respawnCount: 0,
    switchCount: 5,
    puzzles: [
      { puzzleId: 'F-1', solvedAtSeconds: 60, hintStage: 0, explained: values[0] ?? null },
      { puzzleId: 'P1-2', solvedAtSeconds: 200, hintStage: 0, explained: values[1] ?? null },
    ],
  });

  it('記入のあった記録だけを分母にする', () => {
    const records = [record('1', [true, false]), record('2', [true, null]), record('3', [false, false])];
    expect(explainedRatio(records, 'F-1')).toEqual({ yes: 2, asked: 3, ratio: 2 / 3 });
    // P1-2 は 1 名が未記入なので分母から外れる
    expect(explainedRatio(records, 'P1-2')).toEqual({ yes: 0, asked: 2, ratio: 0 });
  });

  it('誰も記入していなければ割合を出さない（0% と区別する）', () => {
    expect(explainedRatio([record('1', [null, null])], 'F-1')).toEqual({ yes: 0, asked: 0, ratio: null });
  });

  it('報告に「所見 2・3 の指標」の節が出る', () => {
    const text = report([record('1', [true, false]), record('2', [true, false])]);
    expect(text).toContain('自分の言葉で説明できたか');
    expect(text).toContain('P1-2');
  });
});
