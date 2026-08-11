/**
 * 試遊記録の集計（T1-20、ゲート G1-3）。
 *
 *   npm run playtest:report -- <記録の JSON ファイル…>
 *   npm run playtest:report -- Docs/measurements/playtest/*.json
 *
 * 1 ファイルに 1 件、または配列で複数件が入っていてよい（画面の「まとめて保存」の形）。
 *
 * **判定の基準**（`Docs/measurements/T1-20_playtest_kit.md` §5）:
 * n = 5〜8 では統計的検定に足りないため、実用上の閾値で見る。
 * パズルごとに、キーボード群とゲームパッド群の**所要時間の中央値**を比べ、
 * 差が遅い側の 50% を超えたら「差あり」として報告する。
 *
 * 所要時間は「そのパズルを解いた時刻 − 直前に解いたパズルの時刻」。
 * 解いた順は人によって違うので、**時刻の差分**で見る（配置順では見ない）。
 *
 * 判定に効く関数は export してある（`tests/unit/playtest_report.test.ts`）。
 * ゲートの合否を決める計算をテストなしで置かないため。
 */
import { readFileSync } from 'node:fs';

export interface PuzzleRecord {
  puzzleId: string;
  solvedAtSeconds: number | null;
  hintStage: number;
  /** 何が起きたか自分の言葉で説明できたか（T1-28）。null は未記入 */
  explained?: boolean | null;
}

export interface PlaytestRecord {
  levelId: string;
  tester: string;
  startedAt: string;
  device: string;
  elapsedSeconds: number;
  cleared: boolean;
  puzzles: PuzzleRecord[];
  solvedCount: number;
  respawnCount: number;
  switchCount: number;
}

/** G1-3 の閾値。中央値の差が「遅い側の何割」を超えたら差ありとするか */
export const DIFFERENCE_THRESHOLD = 0.5;

/** 解いた順に並べ、直前との差から 1 パズルあたりの所要時間を出す */
export function durations(record: PlaytestRecord): Map<string, number> {
  const solved = record.puzzles
    .filter((puzzle): puzzle is PuzzleRecord & { solvedAtSeconds: number } => puzzle.solvedAtSeconds !== null)
    .sort((a, b) => a.solvedAtSeconds - b.solvedAtSeconds);
  const result = new Map<string, number>();
  let previous = 0;
  for (const puzzle of solved) {
    result.set(puzzle.puzzleId, Number((puzzle.solvedAtSeconds - previous).toFixed(1)));
    previous = puzzle.solvedAtSeconds;
  }
  return result;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** 中央値の差の割合（遅い側を分母にする）。片方が居なければ null */
export function differenceRatio(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  const slower = Math.max(a, b);
  return slower === 0 ? 0 : Math.abs(a - b) / slower;
}

export interface PuzzleComparison {
  puzzleId: string;
  keyboardMedian: number | null;
  gamepadMedian: number | null;
  ratio: number | null;
  /** 閾値を超えたか（= G1-3 の要注意） */
  flagged: boolean;
  solvedBy: number;
  hintMedian: number | null;
}

/** パズルごとに、入力デバイス別の所要時間を突き合わせる（G1-3 の中身） */
export function compare(records: readonly PlaytestRecord[]): PuzzleComparison[] {
  const puzzleIds = [...new Set(records.flatMap((record) => record.puzzles.map((puzzle) => puzzle.puzzleId)))];
  const of = (device: string): PlaytestRecord[] => records.filter((record) => record.device === device);
  const keyboard = of('keyboard');
  const gamepad = of('gamepad');

  return puzzleIds.map((puzzleId) => {
    const times = (group: PlaytestRecord[]): number[] =>
      group.map((record) => durations(record).get(puzzleId)).filter((value): value is number => value !== undefined);
    const keyboardMedian = median(times(keyboard));
    const gamepadMedian = median(times(gamepad));
    const ratio = differenceRatio(keyboardMedian, gamepadMedian);
    return {
      puzzleId,
      keyboardMedian,
      gamepadMedian,
      ratio,
      flagged: ratio !== null && ratio > DIFFERENCE_THRESHOLD,
      solvedBy: records.filter((record) =>
        record.puzzles.some((puzzle) => puzzle.puzzleId === puzzleId && puzzle.solvedAtSeconds !== null),
      ).length,
      hintMedian: median(
        records.flatMap((record) =>
          record.puzzles.filter((puzzle) => puzzle.puzzleId === puzzleId).map((puzzle) => puzzle.hintStage),
        ),
      ),
    };
  });
}

/**
 * 「何が起きたか説明できた」割合（T1-28 の追加の観測）。
 *
 * **所見 2・3 が解けたかの直接の指標。** 分母は記入のあった記録だけで、
 * 未記入（進行役が入れなかった）は数えない。
 */
export function explainedRatio(
  records: readonly PlaytestRecord[],
  puzzleId: string,
): { yes: number; asked: number; ratio: number | null } {
  const answers = records
    .flatMap((record) => record.puzzles.filter((puzzle) => puzzle.puzzleId === puzzleId))
    .map((puzzle) => puzzle.explained)
    .filter((value): value is boolean => typeof value === 'boolean');
  const yes = answers.filter(Boolean).length;
  return { yes, asked: answers.length, ratio: answers.length === 0 ? null : yes / answers.length };
}

function minutes(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

export function loadRecords(files: readonly string[]): PlaytestRecord[] {
  const records: PlaytestRecord[] = [];
  for (const file of files) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    for (const record of Array.isArray(parsed) ? parsed : [parsed]) records.push(record as PlaytestRecord);
  }
  return records;
}

export function report(records: readonly PlaytestRecord[]): string {
  const lines: string[] = [];
  const say = (line = ''): void => void lines.push(line);

  say(`試遊記録 ${records.length} 件`);
  say();
  say('| 試遊者 | 入力 | 所要 | 解けた数 | 到達 | 復帰 | 切替 | ヒント段階の合計 |');
  say('|---|---|---|---|---|---|---|---|');
  for (const record of records) {
    const hints = record.puzzles.reduce((sum, puzzle) => sum + puzzle.hintStage, 0);
    say(
      `| ${record.tester || record.startedAt.slice(0, 16)} | ${record.device} | ${minutes(record.elapsedSeconds)} | ` +
        `${record.solvedCount}/${record.puzzles.length} | ${record.cleared ? 'ゴール' : '時間切れ'} | ` +
        `${record.respawnCount} | ${record.switchCount} | ${hints} |`,
    );
  }

  const count = (device: string): number => records.filter((record) => record.device === device).length;
  const undecided = records.filter((record) => record.device === 'mixed' || record.device === 'unknown').length;
  say();
  say(`キーボード ${count('keyboard')} 名 / ゲームパッド ${count('gamepad')} 名 / 判別できず ${undecided} 名`);
  if (undecided > 0) {
    say('  ※ 判別できない記録は G1-3 の比較から除外した（両方触った、または入力が記録されていない）');
  }

  const comparisons = compare(records);
  say();
  say('## パズルごとの所要時間（中央値・秒）');
  say();
  say('| パズル | キーボード | ゲームパッド | 差 | 解けた人数 | ヒント段階の中央値 |');
  say('|---|---|---|---|---|---|');
  for (const row of comparisons) {
    const difference = row.ratio === null ? '—' : `${(row.ratio * 100).toFixed(0)}%${row.flagged ? ' ⚠' : ''}`;
    say(
      `| ${row.puzzleId} | ${row.keyboardMedian ?? '—'} | ${row.gamepadMedian ?? '—'} | ${difference} | ` +
        `${row.solvedBy}/${records.length} | ${row.hintMedian ?? '—'} |`,
    );
  }

  // --- 追加の観測（T1-28）。所見 2・3 が解けたかを直接見る ---
  const explained = comparisons.map((row) => ({ puzzleId: row.puzzleId, ...explainedRatio(records, row.puzzleId) }));
  const asked = explained.reduce((sum, row) => sum + row.asked, 0);
  say();
  say('## 何が起きたか、自分の言葉で説明できたか（所見 2・3 の指標）');
  say();
  if (asked === 0) {
    say('記入なし。終了画面で進行役が可否を入れること（入れないとこの指標は取れない）。');
  } else {
    say('| パズル | 説明できた | 記入あり | 割合 |');
    say('|---|---|---|---|');
    for (const row of explained) {
      const ratio = row.ratio === null ? '—' : `${(row.ratio * 100).toFixed(0)}%`;
      say(`| ${row.puzzleId} | ${row.yes} | ${row.asked} | ${ratio} |`);
    }
    const weak = explained.filter((row) => row.ratio !== null && row.ratio < 0.5).map((row) => row.puzzleId);
    say();
    say(
      weak.length === 0
        ? '✓ どのパズルも半数以上が説明できた。'
        : `✗ 半数が説明できなかったパズル: ${weak.join(', ')}（解けていても、当てずっぽうで通っている疑いがある）`,
    );
  }

  const flagged = comparisons.filter((row) => row.flagged).map((row) => row.puzzleId);
  say();
  say('## G1-3（入力デバイスによる差）');
  say();
  if (count('keyboard') === 0 || count('gamepad') === 0) {
    say('比較できない。キーボード群とゲームパッド群の両方が要る（各 2 名以上を推奨）。');
  } else if (flagged.length === 0) {
    say(`✓ どのパズルでも中央値の差が ${DIFFERENCE_THRESHOLD * 100}% 以内。**G1-3 は通過**。`);
  } else {
    say(`✗ 差が ${DIFFERENCE_THRESHOLD * 100}% を超えたパズル: ${flagged.join(', ')}`);
    say('  そのパズルが要求する入力を洗い出すこと（感圧・アナログの微調整がキーボードで代替できているか）。');
  }

  const respawns = records.map((record) => record.respawnCount);
  const switches = records.map((record) => record.switchCount);
  const stuck = comparisons.filter((row) => (row.hintMedian ?? 0) >= 3).map((row) => row.puzzleId);
  say();
  say('## 併せて見る指標');
  say();
  say(`- 復帰回数: 中央値 ${median(respawns)} / 最大 ${Math.max(...respawns)}（突出していれば実行難度が高すぎる）`);
  say(`- 世代切替: 中央値 ${median(switches)} / 最大 ${Math.max(...switches)}（多すぎれば §15 の疲弊の兆候）`);
  say(
    stuck.length === 0
      ? '- ヒント段階 3 以上に偏るパズル: なし'
      : `- ヒント段階 3 以上に偏るパズル: ${stuck.join(', ')}（手掛かりが足りていない）`,
  );
  say();
  say('G1-1 / G1-2 は聞き取りで判定する（記録シートの Q2 / Q3）。');
  return lines.join('\n');
}

/** CLI として起動されたときだけ実行する（テストから import できるように） */
if (process.argv[1]?.endsWith('playtest-report.ts')) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('使い方: npm run playtest:report -- <記録の JSON ファイル…>');
    process.exit(2);
  }
  const records = loadRecords(files);
  if (records.length === 0) {
    console.error('記録が 1 件も読めなかった');
    process.exit(1);
  }
  console.log(report(records));
}
