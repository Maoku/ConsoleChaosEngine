/**
 * 段階的ヒント（T1-17、GAME_PLAN §13.1、IMPLEMENTATION_PLAN §5.10）。
 *
 * **難易度選択は設けない。代わりに、詰まった人だけが自分のペースで引き出す。**
 * 4 段階のうち段階 1〜3 は時間でも出るが、段階 4（解法の直接提示）は
 * **要求されたときにしか出さない**（自動提示のコードパスを持たない）。
 *
 * 実装上の約束（§5.10）:
 * - 待ち時間は `HINT_DELAYS_MS` に集約する。コードに数値を埋め込まない
 *   （GAME_PLAN §16.1-e：フェーズ 3 のプレイテスト結果で調整するため）
 * - 全段階を設定で完全にオフにできる。**オフのときはタイマーを回さない**
 * - 滞在時間は「そのパズルに取り組んでいる間」だけ進む。離れれば止まる
 *
 * 文面の方針（§13.1）: どの段階でも「答え」ではなく**見る場所**を示す。
 * 段階 2 と、段階 3〜4 の一部に出るチャンネル名は
 * **レベルデータの `requiredGenerations` から組み立てる**。
 * 文面に世代を直書きすると、レベルを直したときに嘘になる。
 */
import type { GenerationId } from '@console-chaos/engine';
import { DISPLAY_NAMES } from '@/config/generation';

/** 段階 0 → 1、1 → 2、2 → 3 の待ち時間（ミリ秒）。§13.1 の 3 分 / 2 分 / 2 分 */
export const HINT_DELAYS_MS: readonly [number, number, number] = [180_000, 120_000, 120_000];

/** 自動で出る最大段階。段階 4 は要求時のみ（§13.1） */
export const AUTO_MAX_STAGE = 3;
export const MAX_STAGE = 4;

export type HintStage = 0 | 1 | 2 | 3 | 4;

/** ヒントを見てもペナルティはない。UI にその旨を出すための定型文（§13.1） */
export const NO_PENALTY_NOTE = 'ヒントを見てもクリア記録は変わらない';

/**
 * 段階 1 と 2 の文面は全パズル共通。
 * 段階 1 は「別の世代を試す」という一手だけを示し、どのパズルかを特定しない。
 */
export const STAGE1_TEXT = 'この場所には、別の世代でしか見えないものがある';
export const STAGE2_TEMPLATE = '{channels} で見てみよう';

export interface HintCopy {
  /** 段階 3：使っている制約を明示する（解法は言わない） */
  stage3: string;
  /** 段階 4：解法の直接提示 */
  stage4: string;
}

/** `{channels}` は対象世代のチャンネル名に置き換わる */
export const HINT_COPY: Record<string, HintCopy> = {
  'F-1': {
    stage3: '色の選択肢が少ない世代では、近い色どうしが同じ 1 色として扱われる。装置はそれを 1 本の物として扱う',
    stage4: '{channels} ではツタが橋になる。色が潰れる世代では 2 本が撚られて太くなり、いちばん楽に渡って行ける',
  },
  'F-2': {
    stage3: '1 本の走査線に並べられる数には上限がある。あふれた分は表示されない',
    stage4: '{channels} では群れがあふれてちらつく。裂け目から覗く灯、その真下の石だけを踏む',
  },
  'S-1': {
    stage3: '床を 1 枚の面として回せる世代がある。回るのは模様だけではなく、面の上にあるものすべて',
    stage4: '{channels} で床が回り、向こう岸の島が近づく。半透明の踏み台から島へ乗って運ばれる',
  },
  'P1-1': {
    stage3: '奥行きが潰れている世代では、手前にある壁を避けようがない',
    stage4: '{channels} で壁の奥側へ回り込み、裏のスイッチに触れる',
  },
  'P1-2': {
    stage3: '奥行きを描画順で解決している世代では、重なりの矛盾がそのまま通り抜けになる',
    stage4: '{channels} で殻の継ぎ目に入り、内部の核に触れる',
  },
  'P2-1': {
    stage3: '動く光を持つ世代だけが、暗闇の中で足元を照らせる',
    stage4: '{channels} では松明が灯る。照らしながら渡り廊下の折れを追い、突き当りの刻印を踏む',
  },
};

/** レベルデータから作る、パズル 1 件分のヒント対象 */
export interface HintTarget {
  puzzleId: string;
  /** レベルの `requiredGenerations`。段階 2 以降の文面を組み立てるのに使う */
  generations: readonly GenerationId[];
}

export interface HintMessage {
  puzzleId: string;
  stage: HintStage;
  text: string;
  /** 自動で出たのか、要求されて出たのか（UI の出し方を変えるため） */
  requested: boolean;
}

interface HintEntry {
  /** 段階 1〜4 の文面（添字 0 が段階 1） */
  texts: readonly [string, string, string, string];
  /** そのパズルに取り組んだ通算時間 */
  elapsedMs: number;
  stage: HintStage;
}

export interface HintState {
  /** オフにすると、タイマーも進まず、表示も消える（§13.1） */
  enabled: boolean;
  readonly entries: Map<string, HintEntry>;
  /** 今表示すべきヒント。無ければ null */
  message: HintMessage | null;
  /** 今どのパズルに取り組んでいるか（滞在時間を進める対象） */
  activePuzzleId: string | null;
}

/** チャンネル名の並び（「CH 1」「CH 3 か CH 4」）。実機名は出さない（§7.1.1） */
export function channelsLabel(generations: readonly GenerationId[]): string {
  const names = generations.map((generation) => DISPLAY_NAMES[generation].channel);
  if (names.length === 0) return 'どこか別のチャンネル';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join('、')} か ${names[names.length - 1]}`;
}

function fill(template: string, generations: readonly GenerationId[]): string {
  return template.replaceAll('{channels}', channelsLabel(generations));
}

/** 4 段階の文面を組み立てる。レベルデータが真実で、文面はそこから導かれる */
export function composeHintTexts(target: HintTarget): [string, string, string, string] {
  const copy = HINT_COPY[target.puzzleId];
  return [
    STAGE1_TEXT,
    fill(STAGE2_TEMPLATE, target.generations),
    copy ? fill(copy.stage3, target.generations) : STAGE1_TEXT,
    copy ? fill(copy.stage4, target.generations) : fill(STAGE2_TEMPLATE, target.generations),
  ];
}

export interface HintOptions {
  /** 既定は有効。設定で完全にオフにできる（§13.1） */
  enabled?: boolean;
}

export function createHintState(targets: readonly HintTarget[], options: HintOptions = {}): HintState {
  const entries = new Map<string, HintEntry>();
  for (const target of targets) {
    entries.set(target.puzzleId, { texts: composeHintTexts(target), elapsedMs: 0, stage: 0 });
  }
  return {
    enabled: options.enabled ?? true,
    entries,
    message: null,
    activePuzzleId: null,
  };
}

/** 段階 n（1..4）に到達するまでの累計待ち時間 */
export function thresholdMs(stage: HintStage): number {
  let total = 0;
  for (let i = 0; i < stage && i < HINT_DELAYS_MS.length; i++) total += HINT_DELAYS_MS[i]!;
  return total;
}

function messageOf(puzzleId: string, entry: HintEntry, requested: boolean): HintMessage | null {
  if (entry.stage === 0) return null;
  return { puzzleId, stage: entry.stage, text: entry.texts[entry.stage - 1]!, requested };
}

/** 段階と滞在時間を捨てる（やり直し時。オン/オフの切替でも使う） */
export function resetHints(state: HintState): void {
  state.message = null;
  state.activePuzzleId = null;
  for (const entry of state.entries.values()) {
    entry.elapsedMs = 0;
    entry.stage = 0;
  }
}

export function setHintsEnabled(state: HintState, enabled: boolean): void {
  state.enabled = enabled;
  // オフにしたら、進んだ段階も滞在時間も捨てる（「見ないで解きたい」を尊重する）
  if (!enabled) resetHints(state);
}

export interface HintUpdate {
  /** 今取り組んでいるパズル。離れていれば null */
  activePuzzleId: string | null;
  solved: ReadonlySet<string>;
  dtMs: number;
}

/**
 * 1 ティック分進める（§4.4 の段階 6 と同じ位置で呼ぶ）。
 * オフのときは何もしない（タイマー自体を回さない）。
 */
export function updateHints(state: HintState, update: HintUpdate): void {
  if (!state.enabled) {
    state.message = null;
    state.activePuzzleId = null;
    return;
  }

  const id = update.activePuzzleId;
  if (id !== state.activePuzzleId) {
    // 別のパズルへ移ったら、前のヒントは消す（段階は保持する）
    state.activePuzzleId = id;
    state.message = null;
  }
  if (id === null) return;

  const entry = state.entries.get(id);
  if (!entry) return;
  if (update.solved.has(id)) {
    // 解けたら表示を消し、滞在時間も止める
    state.message = null;
    return;
  }

  entry.elapsedMs += update.dtMs;
  // 自動提示は段階 3 まで。段階 4 は requestHint からしか到達しない
  while (entry.stage < AUTO_MAX_STAGE && entry.elapsedMs >= thresholdMs((entry.stage + 1) as HintStage)) {
    entry.stage = (entry.stage + 1) as HintStage;
    state.message = messageOf(id, entry, false);
  }
}

/**
 * プレイヤーがヒントを要求した（§13.1「またはプレイヤーがヒントを要求」）。
 * 段階を 1 つ進めて返す。すでに段階 4 なら、その文面をもう一度返す。
 */
export function requestHint(state: HintState, puzzleId: string | null = state.activePuzzleId): HintMessage | null {
  if (!state.enabled || puzzleId === null) return null;
  const entry = state.entries.get(puzzleId);
  if (!entry) return null;

  if (entry.stage < MAX_STAGE) entry.stage = (entry.stage + 1) as HintStage;
  // 手で進めた段階まで自動提示が追いつかないよう、滞在時間も合わせる
  entry.elapsedMs = Math.max(entry.elapsedMs, thresholdMs(entry.stage));
  state.message = messageOf(puzzleId, entry, true);
  return state.message;
}

/** 現在の段階（表示や記録用）。未着手なら 0 */
export function stageOf(state: HintState, puzzleId: string): HintStage {
  return state.entries.get(puzzleId)?.stage ?? 0;
}

/** 何件のヒントが引き出されたか（プレイテストの記録に使う。T1-20） */
export function usedHintCount(state: HintState): number {
  let used = 0;
  for (const entry of state.entries.values()) if (entry.stage > 0) used++;
  return used;
}
