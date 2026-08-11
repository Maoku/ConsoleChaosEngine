/**
 * T1-17「段階的ヒントシステムの最小実装」の検証。
 * 受け入れ条件は「**4 段階が動作し、完全にオフにできる**」。
 */
import { describe, it, expect } from 'vitest';
import {
  AUTO_MAX_STAGE,
  channelsLabel,
  composeHintTexts,
  createHintState,
  HINT_COPY,
  HINT_DELAYS_MS,
  MAX_STAGE,
  requestHint,
  setHintsEnabled,
  stageOf,
  thresholdMs,
  updateHints,
  usedHintCount,
  type HintState,
} from '@/gameplay/hints';
import { createSession } from '@/gameplay/session';
import { TICK_MS } from '@/core/time';
import { loadLevelFile } from './replay/harness';

const TARGETS = [
  { puzzleId: 'F-1', generations: ['FC'] as const },
  { puzzleId: 'P1-1', generations: ['PS1', 'PS2'] as const },
];

function fresh(enabled = true): HintState {
  return createHintState(TARGETS, { enabled });
}

/** 指定ミリ秒だけ、同じパズルの前に立ち続ける */
function dwell(state: HintState, puzzleId: string, ms: number): void {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    updateHints(state, { activePuzzleId: puzzleId, solved: new Set(), dtMs: TICK_MS });
  }
}

describe('gameplay/hints（4 段階）', () => {
  it('待ち時間はテーブルに集約されている（コードに数値を埋めない。§16.1-e）', () => {
    expect(HINT_DELAYS_MS).toEqual([180_000, 120_000, 120_000]);
    expect(thresholdMs(1)).toBe(180_000);
    expect(thresholdMs(3)).toBe(420_000);
  });

  it('3 分 → 2 分 → 2 分で段階 1・2・3 が自動で出る', () => {
    const state = fresh();
    dwell(state, 'F-1', 179_000);
    expect(state.message).toBeNull();

    dwell(state, 'F-1', 2_000);
    expect(state.message?.stage).toBe(1);
    expect(state.message?.requested).toBe(false);

    dwell(state, 'F-1', 120_000);
    expect(state.message?.stage).toBe(2);

    dwell(state, 'F-1', 120_000);
    expect(state.message?.stage).toBe(3);
  });

  it('段階 4 は自動では絶対に出ない（要求時のみ。§13.1）', () => {
    const state = fresh();
    dwell(state, 'F-1', 60 * 60 * 1000); // 1 時間放置
    expect(stageOf(state, 'F-1')).toBe(AUTO_MAX_STAGE);

    expect(requestHint(state, 'F-1')?.stage).toBe(MAX_STAGE);
  });

  it('要求すれば待たずに段階が上がり、段階 4 で止まる', () => {
    const state = fresh();
    expect(requestHint(state, 'F-1')?.stage).toBe(1);
    expect(requestHint(state, 'F-1')?.stage).toBe(2);
    expect(requestHint(state, 'F-1')?.stage).toBe(3);
    expect(requestHint(state, 'F-1')?.stage).toBe(4);
    expect(requestHint(state, 'F-1')?.stage).toBe(4);
  });

  it('手で進めた段階を、あとから自動提示が巻き戻さない', () => {
    const state = fresh();
    requestHint(state, 'F-1');
    requestHint(state, 'F-1'); // 段階 2
    dwell(state, 'F-1', 1_000);
    expect(stageOf(state, 'F-1')).toBe(2);
  });

  it('別のパズルへ移ると滞在時間は進まない（同一パズルでの経過を数える）', () => {
    const state = fresh();
    dwell(state, 'F-1', 170_000);
    dwell(state, 'P1-1', 170_000);
    expect(state.message).toBeNull();
    dwell(state, 'F-1', 11_000);
    expect(state.message?.puzzleId).toBe('F-1');
  });

  it('解けたパズルではヒントが消える', () => {
    const state = fresh();
    dwell(state, 'F-1', 181_000);
    expect(state.message).not.toBeNull();
    updateHints(state, { activePuzzleId: 'F-1', solved: new Set(['F-1']), dtMs: TICK_MS });
    expect(state.message).toBeNull();
  });

  it('完全にオフにできる。オフの間はタイマーが進まない', () => {
    const state = fresh(false);
    dwell(state, 'F-1', 10 * 60 * 1000);
    expect(state.message).toBeNull();
    expect(stageOf(state, 'F-1')).toBe(0);
    expect(requestHint(state, 'F-1')).toBeNull();

    // オンに戻しても、オフの間の経過は数えない
    setHintsEnabled(state, true);
    dwell(state, 'F-1', 179_000);
    expect(state.message).toBeNull();
  });

  it('オフにすると引き出し済みのヒントも消える', () => {
    const state = fresh();
    requestHint(state, 'F-1');
    expect(usedHintCount(state)).toBe(1);
    setHintsEnabled(state, false);
    expect(usedHintCount(state)).toBe(0);
    expect(state.message).toBeNull();
  });
});

describe('gameplay/hints の文面', () => {
  it('段階 2 はレベルデータの対象世代から組み立てる（文面に世代を直書きしない）', () => {
    expect(channelsLabel(['FC'])).toBe('CH 1');
    expect(channelsLabel(['PS1', 'PS2'])).toBe('CH 3 か CH 4');
    const texts = composeHintTexts({ puzzleId: 'P1-1', generations: ['PS1', 'PS2'] });
    expect(texts[1]).toBe('CH 3 か CH 4 で見てみよう');
    expect(texts[3]).toContain('CH 3 か CH 4');
  });

  it('★ パズル 6 件すべてに段階 3・4 の文面がある', () => {
    for (const id of ['F-1', 'F-2', 'S-1', 'P1-1', 'P1-2', 'P2-1']) {
      expect(HINT_COPY[id]?.stage3.length ?? 0).toBeGreaterThan(0);
      expect(HINT_COPY[id]?.stage4.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('段階 1〜3 は解法を書かない（「答え」ではなく「見る場所」）', () => {
    // 段階 4 にだけ操作の指示（「触れる」「踏む」「渡って」など）が現れる
    const verbs = ['触れる', '踏む', '渡って', '走り抜けて', '乗って', '入り'];
    for (const id of Object.keys(HINT_COPY)) {
      const texts = composeHintTexts({ puzzleId: id, generations: ['FC'] });
      for (const stage of [0, 1, 2]) {
        expect(verbs.some((verb) => texts[stage]!.includes(verb))).toBe(false);
      }
      expect(verbs.some((verb) => texts[3]!.includes(verb))).toBe(true);
    }
  });
});

describe('gameplay/session とヒントの接続', () => {
  const level = loadLevelFile('area1');

  it('パズルの近くに立つと、そのパズルが対象になる', () => {
    const session = createSession({ level, generation: 'PS1' });
    session.tick(null);
    // 出発地点はどのパズルからも遠い
    expect(session.activePuzzleId).toBeNull();

    // F-1 の要素の位置へ直接置く
    const vine = level.entities.find((entity) => entity.id === 'f1_vine_a')!;
    session.player.position = [...vine.transform.position] as [number, number, number];
    session.tick(null);
    expect(session.activePuzzleId).toBe('F-1');
  });

  it('セッション経由でヒントを要求できる', () => {
    const session = createSession({ level, generation: 'PS1' });
    const vine = level.entities.find((entity) => entity.id === 'f1_vine_a')!;
    session.player.position = [...vine.transform.position] as [number, number, number];
    session.tick(null);

    const message = session.requestHint();
    expect(message?.puzzleId).toBe('F-1');
    expect(message?.stage).toBe(1);
    expect(session.hints.message?.text).toContain('別の世代');
  });

  it('オフにしたセッションではヒントが出ない', () => {
    const session = createSession({ level, generation: 'PS1', hints: { enabled: false } });
    const vine = level.entities.find((entity) => entity.id === 'f1_vine_a')!;
    session.player.position = [...vine.transform.position] as [number, number, number];
    for (let i = 0; i < 60 * 60 * 5; i++) session.tick(null); // 5 分
    expect(session.hints.message).toBeNull();
    expect(session.requestHint()).toBeNull();
  });
});
