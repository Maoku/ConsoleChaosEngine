/**
 * 外部プレイテストの記録（T1-20、IMPLEMENTATION_PLAN §8.2）。
 *
 * **受け入れ条件は「各パズルのクリア時間を記録し、ゲート判定に用いる」。**
 * ゲート G1-3（キーボード勢とゲームパッド勢でクリア時間に有意差が出ないか）を
 * 判定するには、time だけでなく**どちらの入力で遊んだか**が要る。
 * 人手のストップウォッチでは 5〜8 名分の粒度が揃わないので、ここで機械的に取る。
 *
 * 取るのは操作の記録ではなく**結果の要約**だけ（プレイヤーの入力列は保存しない）。
 * 出力は JSON。集計手順は `Docs/PLAYTEST.md` に置く。
 *
 * G1-1（第1世代の強みを自発的に言語化できるか）と G1-2（キャラクターの読みやすさ）は
 * 言葉で聞くしかないので、ここでは扱わない。記録シートの担当。
 */
import type { Session } from '@/gameplay/session';
import { stageOf } from '@/gameplay/hints';

export type InputDevice = 'keyboard' | 'gamepad' | 'mixed' | 'unknown';

export interface PuzzleRecord {
  puzzleId: string;
  /** 計測開始からの経過（秒）。未クリアなら null */
  solvedAtSeconds: number | null;
  /** そのパズルで引き出したヒントの最終段階（0 = 使わなかった） */
  hintStage: number;
  /**
   * **何が起きたか、試遊者が自分の言葉で説明できたか**（T1-28 の追加の観測）。
   * null は未記入。進行役が終了画面で入れる。
   *
   * 所見 2・3（見た目で世代差が分からない）が解けたかの**直接の指標**であり、
   * クリア時間より重い。解けていても説明できなければ、当てずっぽうで通っている
   */
  explained: boolean | null;
}

export interface PlaytestRecord {
  levelId: string;
  /** 試遊者の識別（匿名の通し番号。氏名は入れない） */
  tester: string;
  startedAt: string;
  device: InputDevice;
  /** 計測開始からの経過（秒） */
  elapsedSeconds: number;
  /** ゴールに到達したか。時間切れで終えた場合は false */
  cleared: boolean;
  puzzles: PuzzleRecord[];
  solvedCount: number;
  respawnCount: number;
  /** 世代を切り替えた回数（多すぎれば §15「切替の多用による疲弊」の兆候） */
  switchCount: number;
}

export interface PlaytestLog {
  /** 毎フレーム呼ぶ */
  update(): void;
  /** 記録を取り出す */
  record(): PlaytestRecord;
  /** 記録を JSON で保存する（ブラウザのダウンロード） */
  save(): void;
  /** localStorage へ退避する（保存し忘れ・ブラウザ事故への備え） */
  keep(): void;
  /** 試遊者の識別を設定する */
  setTester(tester: string): void;
  /** ゴール到達を記録する */
  markCleared(): void;
  /** 「自分の言葉で説明できたか」を記入する（進行役が終了画面で押す） */
  setExplained(puzzleId: string, value: boolean): void;
  reset(): void;
  dispose(): void;
}

/** localStorage のキーの接頭辞。記録は 1 回の試遊につき 1 件 */
export const STORAGE_PREFIX = 'chaos.playtest.';

/** 退避してある記録をすべて取り出す（保存し忘れの回収用） */
export function storedRecords(): PlaytestRecord[] {
  const records: PlaytestRecord[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === null || !key.startsWith(STORAGE_PREFIX)) continue;
    try {
      records.push(JSON.parse(localStorage.getItem(key) ?? '') as PlaytestRecord);
    } catch {
      // 壊れた記録は無視する（回収できるものだけ返す）
    }
  }
  return records.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** 退避してある記録をまとめて 1 つの JSON で保存する（集計にかける形） */
export function saveStoredRecords(): void {
  downloadJson('playtest_all.json', JSON.stringify(storedRecords(), null, 2));
}

function downloadJson(filename: string, json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** ゲームパッドが実際に触られたか（接続されているだけでは「使った」と見なさない） */
function gamepadActive(): boolean {
  const pads = navigator.getGamepads?.() ?? [];
  for (const pad of pads) {
    if (!pad) continue;
    if (pad.buttons.some((button) => button.pressed)) return true;
    if (pad.axes.some((axis) => Math.abs(axis) > 0.3)) return true;
  }
  return false;
}

export function createPlaytestLog(session: Session, levelId: string): PlaytestLog {
  let startedAt = new Date().toISOString();
  let startMs = performance.now();
  let usedKeyboard = false;
  let usedGamepad = false;
  let switchCount = 0;
  let lastGeneration = session.generation.generation;
  let tester = '';
  let cleared = false;
  const solvedAt = new Map<string, number>();
  const hintStages = new Map<string, number>();
  const explained = new Map<string, boolean>();

  const onKey = (): void => {
    usedKeyboard = true;
  };
  window.addEventListener('keydown', onKey);

  function device(): InputDevice {
    if (usedKeyboard && usedGamepad) return 'mixed';
    if (usedKeyboard) return 'keyboard';
    if (usedGamepad) return 'gamepad';
    return 'unknown';
  }

  function currentRecord(): PlaytestRecord {
    return {
      levelId,
      tester,
      startedAt,
      device: device(),
      elapsedSeconds: Number(((performance.now() - startMs) / 1000).toFixed(1)),
      cleared,
      puzzles: session.level.puzzles.map((placement) => ({
        puzzleId: placement.puzzleId,
        solvedAtSeconds: solvedAt.has(placement.puzzleId)
          ? Number(solvedAt.get(placement.puzzleId)!.toFixed(1))
          : null,
        hintStage: hintStages.get(placement.puzzleId) ?? 0,
        explained: explained.get(placement.puzzleId) ?? null,
      })),
      solvedCount: session.solved.size,
      respawnCount: session.checkpoints.respawnCount,
      switchCount,
    };
  }

  return {
    update(): void {
      if (gamepadActive()) usedGamepad = true;
      if (session.generation.generation !== lastGeneration) {
        switchCount++;
        lastGeneration = session.generation.generation;
      }
      const now = (performance.now() - startMs) / 1000;
      for (const puzzleId of session.solved) {
        if (!solvedAt.has(puzzleId)) solvedAt.set(puzzleId, now);
      }
      // ヒントは「そのパズルで最終的にどこまで見たか」を残す
      for (const placement of session.level.puzzles) {
        const stage = stageOf(session.hints, placement.puzzleId);
        if (stage > (hintStages.get(placement.puzzleId) ?? 0)) hintStages.set(placement.puzzleId, stage);
      }
    },
    record: currentRecord,
    save(): void {
      const name = tester === '' ? startedAt.replace(/[:.]/g, '-') : tester;
      downloadJson(`playtest_${levelId}_${name}.json`, JSON.stringify(currentRecord(), null, 2));
    },
    keep(): void {
      try {
        localStorage.setItem(`${STORAGE_PREFIX}${startedAt}`, JSON.stringify(currentRecord()));
      } catch {
        // 保存できない設定でも試遊は続けられる（退避は保険であって本体ではない）
      }
    },
    setTester(next): void {
      tester = next;
    },
    markCleared(): void {
      cleared = true;
    },
    setExplained(puzzleId, value): void {
      explained.set(puzzleId, value);
    },
    reset(): void {
      // やり直しは「別の試遊」として記録する（前の記録は localStorage に残る）
      startedAt = new Date().toISOString();
      startMs = performance.now();
      solvedAt.clear();
      hintStages.clear();
      explained.clear();
      switchCount = 0;
      cleared = false;
      lastGeneration = session.generation.generation;
    },
    dispose(): void {
      window.removeEventListener('keydown', onKey);
    },
  };
}
