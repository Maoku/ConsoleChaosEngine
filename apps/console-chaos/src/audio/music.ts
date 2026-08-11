/**
 * エリア 1 の BGM — 各曲 × 4 編曲（T1-16、GAME_PLAN §9.1 / §9.2）。
 *
 * **1 つの楽曲を 4 通りに鳴らす。** 世代ごとに変わるのは
 *   1. どのトラックを鳴らすか（編曲）
 *   2. どの音源で鳴らすか（`sources.ts`）
 * の 2 点だけで、テンポ・拍子・小節数は 4 編曲で完全に一致する。
 * これにより切替時に**小節位置が保たれる**（T1-16 の受け入れ条件）。
 *
 * 曲そのものは 2 つある（`AREA1_SONG_POP` / `AREA1_SONG_CALM`）。
 * **これは世代の分岐ではなく選曲**で、目録は `songs.ts` が持つ。
 * どちらの曲も同じ `arrangeFor` を通るので、4 編曲の約束は曲を跨いで同じ。
 *
 * IMPLEMENTATION_PLAN §3 のツリーには無いファイル。§5.8 は `score.ts` を
 * 「楽曲データ形式」と定めるが、**楽曲そのもの**の置き場を定めていない。
 * 形式（score.ts）と作品（music.ts）を分けたいので、T1-16 で新設した。
 *
 * 編曲の判断は **`profile.audio` の値だけ**で行う（不変条件 I2）。
 * 「第1世代だからパッドを外す」ではなく「同時発音数が足りないから外す」と書く。
 *
 * ## 2 曲の性格
 * | | `AREA1_SONG_POP`（既定） | `AREA1_SONG_CALM` |
 * |---|---|---|
 * | 調 / 速さ | ハ長調・138BPM | イ短調・108BPM |
 * | 性格 | 明るく弾む | 落ち着いた原曲（T1-16 当初） |
 * | 小節 | 8 | 8 |
 *
 * 曲を跨いだ切替では**テンポが違うので位相は保てない**（`songs.ts` の注記）。
 * 世代切替の位相同期は「同じ曲の中で」の約束であって、選曲には及ばない。
 */
import type { GenerationProfile } from '@/generation/profiles';
import { scoreLengthTicks, type Note, type Score, type Track, type TrackRole } from './score';

/** 編曲の分岐点。すべて「同時発音数がいくつ以上あるか」で書く（§9.1 の 5 / 8 / 24 / 48） */
export const PAD_MIN_CHANNELS = 8;
export const HARMONY_MIN_CHANNELS = 24;
export const AMBIENCE_MIN_CHANNELS = 48;

/**
 * 打楽器のノート番号は音程ではなく音色番号（score.ts の Note.pitch の注記）。
 *
 * ただし各音源はこの番号を `pitchToFrequency` 経由の**再生レート**として使うため
 *（`sampler_sfc.ts` は `max(f / 220, 0.25)`、`synth_fc.ts` は `max(f / 440, 0.05)`）、
 * 0 / 1 / 2 のような小さい値だと 3 種とも下限に張り付いて**同じ音**になる。
 * 3 声を打ち分けるために、レートが 0.3 / 0.8 / 1.6 付近へ散る音高を選んである。
 */
export const PERC_KICK = 36; // C2 ≒ 65Hz → 低い胴鳴り
export const PERC_SNARE = 53; // F3 ≒ 175Hz → 裏拍の芯
export const PERC_HAT = 65; // F4 ≒ 349Hz → 8 分の刻み

const TICKS_PER_BEAT = 4;
const BEATS_PER_BAR = 4;
const BAR = TICKS_PER_BEAT * BEATS_PER_BAR;

/** 1 トラック分のノートを `[tick, pitch, durationTicks]` の並びから作る */
function notes(rows: ReadonlyArray<readonly [number, number, number]>, velocity: number): Note[] {
  return rows.map(([tick, pitch, durationTicks]) => ({ tick, pitch, durationTicks, velocity }));
}

/** 小節番号ぶんだけ tick をずらす */
function atBar(bar: number, rows: ReadonlyArray<readonly [number, number, number]>): Array<readonly [number, number, number]> {
  return rows.map(([tick, pitch, duration]) => [bar * BAR + tick, pitch, duration] as const);
}

/** 同じ形を小節ごとに繰り返す（打楽器・ベースの反復に使う） */
function repeat(bars: number, rows: ReadonlyArray<readonly [number, number, number]>): Array<readonly [number, number, number]> {
  const out: Array<readonly [number, number, number]> = [];
  for (let bar = 0; bar < bars; bar++) out.push(...atBar(bar, rows));
  return out;
}

const BARS = 8;

// ───────────────────────────────────────────────────────────────
// 曲 1「パレットの回廊（ポップ）」— ハ長調 / 138BPM / 8 小節
// ───────────────────────────────────────────────────────────────

/**
 * 主旋律。ハ長調・8 小節。
 * 第1世代の矩形波でも輪郭が立つよう、8 分を主体にして装飾音を持たせない。
 * 前半（1〜4 小節）は G5 中心、後半（5〜8 小節）は C6 まで上げて「開ける」。
 */
const POP_LEAD: Note[] = notes(
  [
    // 1 小節目 C：跳ねる問いかけ
    ...atBar(0, [[0, 79, 2], [2, 76, 2], [4, 79, 2], [6, 81, 2], [8, 79, 4], [12, 76, 4]]),
    // 2 小節目 G：受けて下りる
    ...atBar(1, [[0, 81, 2], [2, 79, 2], [4, 76, 4], [8, 74, 6], [14, 76, 2]]),
    // 3 小節目 Am
    ...atBar(2, [[0, 76, 2], [2, 77, 2], [4, 76, 2], [6, 74, 2], [8, 72, 4], [12, 74, 4]]),
    // 4 小節目 F：前半を閉じる
    ...atBar(3, [[0, 77, 2], [2, 79, 2], [4, 81, 4], [8, 79, 2], [10, 77, 2], [12, 72, 4]]),
    // 5 小節目 F：後半は 1 オクターブ近く上から
    ...atBar(4, [[0, 81, 2], [2, 84, 2], [4, 81, 4], [8, 79, 2], [10, 81, 2], [12, 77, 4]]),
    // 6 小節目 G：最高音 C6
    ...atBar(5, [[0, 79, 2], [2, 83, 2], [4, 84, 4], [8, 83, 2], [10, 81, 2], [12, 79, 4]]),
    // 7 小節目 Em → Am
    ...atBar(6, [[0, 76, 2], [2, 79, 2], [4, 83, 4], [8, 81, 2], [10, 79, 2], [12, 76, 4]]),
    // 8 小節目 F → G：D5 で終わり、ループ頭の G5 へ返す
    ...atBar(7, [[0, 77, 2], [2, 81, 2], [4, 77, 4], [8, 79, 2], [10, 83, 2], [12, 74, 4]]),
  ],
  0.9,
);

/**
 * ベース。三角波（第1世代）でそのまま鳴る音域（E2〜C3）に置く。
 * tick 6 の押しと tick 14 のオクターブが、この曲の「弾み」の出どころ。
 */
function popBassBar(root: number): Array<readonly [number, number, number]> {
  return [
    [0, root, 3],
    [6, root, 2], // 2 拍目裏の押し
    [8, root + 7, 3], // 3 拍目は 5 度
    [12, root, 2],
    [14, root + 12, 1], // 次の小節へ向かう跳ね
  ];
}

/** 半小節で和音が変わる小節用（7・8 小節目） */
function popBassHalfBar(root: number): Array<readonly [number, number, number]> {
  return [
    [0, root, 3],
    [6, root + 7, 2],
  ];
}

const POP_BASS: Note[] = notes(
  [
    ...atBar(0, popBassBar(48)), // C
    ...atBar(1, popBassBar(43)), // G
    ...atBar(2, popBassBar(45)), // Am
    ...atBar(3, popBassBar(41)), // F
    ...atBar(4, popBassBar(41)), // F
    ...atBar(5, popBassBar(43)), // G
    ...atBar(6, popBassHalfBar(40)), // Em
    ...atBar(6, popBassHalfBar(45).map(([t, p, d]) => [t + BAR / 2, p, d] as const)), // Am
    ...atBar(7, popBassHalfBar(41)), // F
    ...atBar(7, popBassHalfBar(43).map(([t, p, d]) => [t + BAR / 2, p, d] as const)), // G
  ],
  1,
);

/**
 * 打楽器。ノイズ 1 声しか割けない世代のために、
 * **拍頭（tick 0 / 8）だけを残しても「キック → スネア」の骨格が残る**ように置く。
 * ハイハットは 0 / 8 を避けて置く（拍頭に 2 声重ねると 5 声の枠を超えるため）。
 */
const POP_PERC_BAR: ReadonlyArray<readonly [number, number, number]> = [
  [0, PERC_KICK, 2],
  [2, PERC_HAT, 1],
  [4, PERC_HAT, 1],
  [6, PERC_KICK, 2], // 裏拍の押し。ベースの tick 6 と揃える
  [8, PERC_SNARE, 2],
  [10, PERC_HAT, 1],
  [12, PERC_HAT, 1],
  [14, PERC_HAT, 1],
];

/** 8 小節目のフィル。ループの切れ目を「聞かせて」1 小節目へ返す */
const POP_PERC_FILL: ReadonlyArray<readonly [number, number, number]> = [
  [0, PERC_KICK, 2],
  [2, PERC_HAT, 1],
  [4, PERC_SNARE, 1],
  [6, PERC_KICK, 2],
  [8, PERC_SNARE, 2],
  [11, PERC_SNARE, 1],
  [13, PERC_SNARE, 1],
  [15, PERC_SNARE, 1],
];

const POP_PERC: Note[] = notes([...repeat(BARS - 1, POP_PERC_BAR), ...atBar(BARS - 1, POP_PERC_FILL)], 0.7);

/**
 * パッド（和音の持続）。同時発音数に余裕のある世代でだけ鳴る。
 * 3 声を超えないこと（第2世代は lead + bass + perc + pad = 8 − 2 声ちょうどで収まる）。
 */
function padChord(bar: number, pitches: readonly number[], from = 0, duration = BAR): Array<readonly [number, number, number]> {
  return pitches.map((pitch) => [bar * BAR + from, pitch, duration] as const);
}

const CHORD_C = [60, 64, 67];
const CHORD_G = [59, 62, 67];
const CHORD_AM = [60, 64, 69];
const CHORD_F = [60, 65, 69];
const CHORD_EM = [59, 64, 67];

const POP_PAD: Note[] = notes(
  [
    ...padChord(0, CHORD_C),
    ...padChord(1, CHORD_G),
    ...padChord(2, CHORD_AM),
    ...padChord(3, CHORD_F),
    ...padChord(4, CHORD_F),
    ...padChord(5, CHORD_G),
    ...padChord(6, CHORD_EM, 0, BAR / 2),
    ...padChord(6, CHORD_AM, BAR / 2, BAR / 2),
    ...padChord(7, CHORD_F, 0, BAR / 2),
    ...padChord(7, CHORD_G, BAR / 2, BAR / 2),
  ],
  0.5,
);

/**
 * 楽曲の真実（全パート）。編曲はここから**引くか、これを厚くする**だけで、
 * 音の位置（tick）を動かさない。動かすと小節位置の一致が崩れる。
 */
export const AREA1_SONG_POP: Score = {
  bpm: 138,
  ticksPerBeat: TICKS_PER_BEAT,
  beatsPerBar: BEATS_PER_BAR,
  tracks: [
    { role: 'lead', notes: POP_LEAD },
    { role: 'bass', notes: POP_BASS },
    { role: 'perc', notes: POP_PERC },
    { role: 'pad', notes: POP_PAD },
  ],
};

// ───────────────────────────────────────────────────────────────
// 曲 2「パレットの回廊（原曲）」— イ短調 / 108BPM / 8 小節
// T1-16 当初の曲。ポップ版に差し替えたあとも選曲で戻せるように残してある。
// 音階はイ短調（= ハ長調と同じ構成音）なので、`degreesBelow` のハーモニーもそのまま働く。
// ───────────────────────────────────────────────────────────────

/** 主旋律。跳躍を大きめに取り、装飾音を持たせない（第1世代の矩形波で輪郭を立てるため） */
const CALM_LEAD: Note[] = notes(
  [
    [0, 69, 6], [8, 72, 4], [12, 76, 4],
    [16, 74, 6], [24, 72, 8],
    [32, 71, 6], [40, 74, 4], [44, 77, 4],
    [48, 76, 12],
    [64, 69, 6], [72, 72, 4], [76, 79, 4],
    [80, 77, 6], [88, 76, 8],
    [96, 74, 6], [104, 71, 4], [108, 74, 4],
    [112, 69, 14],
  ],
  0.9,
);

/** ベース。三角波（第1世代）でそのまま鳴る音域に置く */
const CALM_BASS: Note[] = notes(
  [
    ...repeat(2, [[0, 45, 6], [8, 45, 4], [12, 52, 4]]),
    ...atBar(2, repeat(2, [[0, 43, 6], [8, 43, 4], [12, 50, 4]])),
    ...atBar(4, repeat(2, [[0, 41, 6], [8, 41, 4], [12, 48, 4]])),
    ...atBar(6, repeat(2, [[0, 45, 6], [8, 40, 4], [12, 47, 4]])),
  ],
  1,
);

/** 打楽器。ノイズ 1 声しか割けない世代のために、裏拍を落としても形が残るように置く */
const CALM_PERC: Note[] = notes(
  repeat(BARS, [
    [0, PERC_KICK, 2],
    [4, PERC_HAT, 1],
    [8, PERC_SNARE, 2],
    [12, PERC_HAT, 1],
    [14, PERC_HAT, 1],
  ]),
  0.7,
);

/** パッド（和音の持続）。同時発音数に余裕のある世代でだけ鳴る */
const CALM_PAD: Note[] = notes(
  [
    ...padChord(0, [57, 60, 64]),
    ...padChord(1, [57, 60, 64]),
    ...padChord(2, [55, 59, 62]),
    ...padChord(3, [55, 59, 62]),
    ...padChord(4, [53, 57, 60]),
    ...padChord(5, [53, 57, 60]),
    ...padChord(6, [52, 55, 59]),
    ...padChord(7, [45, 52, 57]),
  ],
  0.5,
);

export const AREA1_SONG_CALM: Score = {
  bpm: 108,
  ticksPerBeat: TICKS_PER_BEAT,
  beatsPerBar: BEATS_PER_BAR,
  tracks: [
    { role: 'lead', notes: CALM_LEAD },
    { role: 'bass', notes: CALM_BASS },
    { role: 'perc', notes: CALM_PERC },
    { role: 'pad', notes: CALM_PAD },
  ],
};

function trackNotes(score: Score, role: TrackRole): Note[] {
  return score.tracks.filter((track) => track.role === role).flatMap((track) => track.notes);
}

/** 拍頭だけを残す（ノイズ 1 声しか割けない世代の打楽器） */
function onStrongBeats(source: readonly Note[]): Note[] {
  return source.filter((note) => note.tick % (TICKS_PER_BEAT * 2) === 0);
}

/** ハ長調の音度（ハーモニーを音階の中で作るために持つ） */
const C_MAJOR_DEGREES = [0, 2, 4, 5, 7, 9, 11];

/**
 * 音階上で n 度下げる。長調で単純に −3 半音すると
 * 半分の音が音階外（C♯ / F♯ / G♯）に落ちて濁るため、音度で下げる。
 */
function degreesBelow(pitch: number, degrees: number): number {
  const index = C_MAJOR_DEGREES.indexOf(((pitch % 12) + 12) % 12);
  if (index < 0) return pitch - 3; // 音階外の音は平行 3 度で逃がす
  const absolute = Math.floor(pitch / 12) * C_MAJOR_DEGREES.length + index - degrees;
  const octave = Math.floor(absolute / C_MAJOR_DEGREES.length);
  return octave * 12 + C_MAJOR_DEGREES[absolute - octave * C_MAJOR_DEGREES.length]!;
}

/** 音を足す方向の編曲（音階上の 3 度下）。原曲の音を動かさず、重ねるだけにする */
function harmonized(source: readonly Note[], degrees: number, velocityScale: number): Note[] {
  return source.map((note) => ({
    ...note,
    pitch: degreesBelow(note.pitch, degrees),
    velocity: note.velocity * velocityScale,
  }));
}

/** 音を足す方向の編曲（オクターブ移動）。音階に関係なく安全に重ねられる */
function shifted(source: readonly Note[], semitones: number, velocityScale: number): Note[] {
  return source.map((note) => ({
    ...note,
    pitch: note.pitch + semitones,
    velocity: note.velocity * velocityScale,
  }));
}

/**
 * プロファイルに合わせた編曲を返す（同じ曲・同じ小節構造）。
 *
 * | 判断 | 条件 | 効果 |
 * |---|---|---|
 * | 打楽器を間引く | 同時発音数 < 8 | 拍頭のみ。ノイズ 1 声で「キック → スネア」を成立させる |
 * | パッドを載せる | 同時発音数 >= 8 | 和音の持続が入り、曲が「広がる」 |
 * | ハーモニーを載せる | 同時発音数 >= 24 | 主旋律の音階上 3 度下 |
 * | 環境レイヤを載せる | 同時発音数 >= 48 | 1 オクターブ上の薄いパッド（§9.3 の「意味のある音が埋もれる」） |
 */
export function arrangeFor(profile: GenerationProfile, base: Score = AREA1_SONG_POP): Score {
  const channels = profile.audio.channels;
  const lead = trackNotes(base, 'lead');
  const tracks: Track[] = [
    { role: 'lead', notes: lead },
    { role: 'bass', notes: trackNotes(base, 'bass') },
    {
      role: 'perc',
      notes: channels >= PAD_MIN_CHANNELS ? trackNotes(base, 'perc') : onStrongBeats(trackNotes(base, 'perc')),
    },
  ];
  if (channels >= PAD_MIN_CHANNELS) tracks.push({ role: 'pad', notes: trackNotes(base, 'pad') });
  if (channels >= HARMONY_MIN_CHANNELS) tracks.push({ role: 'lead', notes: harmonized(lead, 2, 0.6) });
  if (channels >= AMBIENCE_MIN_CHANNELS) {
    tracks.push({ role: 'pad', notes: shifted(trackNotes(base, 'pad'), 12, 0.35) });
  }
  return { bpm: base.bpm, ticksPerBeat: base.ticksPerBeat, beatsPerBar: base.beatsPerBar, tracks };
}

/**
 * 同時に鳴る最大声数。編曲が同時発音数の枠に収まっているかの検査に使う。
 * 効果音の分（`SFX_HEADROOM_VOICES`）は差し引いて考える。
 */
export function maxSimultaneousVoices(score: Score): number {
  const events: Array<{ at: number; delta: number }> = [];
  for (const track of score.tracks) {
    for (const note of track.notes) {
      events.push({ at: note.tick, delta: 1 });
      events.push({ at: note.tick + note.durationTicks, delta: -1 });
    }
  }
  // 同時刻では終了を先に処理する（隣り合う音を重なりと数えない）
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  for (const event of events) {
    current += event.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

/** 効果音のために空けておく声数。BGM の編曲はこれを差し引いた枠に収める（§9.3） */
export const SFX_HEADROOM_VOICES = 2;

/** 4 編曲で小節構造が一致していること（位相同期の前提）を確かめる */
export function sameBarStructure(a: Score, b: Score): boolean {
  return (
    a.bpm === b.bpm &&
    a.ticksPerBeat === b.ticksPerBeat &&
    a.beatsPerBar === b.beatsPerBar &&
    scoreLengthTicks(a) === scoreLengthTicks(b)
  );
}
