/**
 * 世代非依存の楽曲データ形式（§5.8、GAME_PLAN §9.1）。
 *
 * **同一の Score を 4 通りに再生する。** 世代ごとの実装は Score を読んで音を出すだけで、
 * 楽曲データを持たない。これにより「同じ曲が、その時代の音で鳴る」が成立する。
 *
 * トラックは楽器名ではなく**役割**で持つ。第1世代では lead が矩形波に、
 * 第4世代では同じ lead がストリーミング音源に割り当てられる。
 */

export type TrackRole = 'lead' | 'bass' | 'perc' | 'pad' | 'fx';

export interface Note {
  /** 曲頭からのティック */
  tick: number;
  durationTicks: number;
  /** MIDI ノート番号（60 = 中央ハ）。perc では音色番号として使う */
  pitch: number;
  /** 0..1 */
  velocity: number;
}

export interface Track {
  role: TrackRole;
  notes: Note[];
}

export interface Score {
  bpm: number;
  ticksPerBeat: number;
  /** 1 小節の拍数。位相同期の単位になる */
  beatsPerBar: number;
  tracks: Track[];
}

/** 1 ティックの長さ（秒） */
export function secondsPerTick(score: Score): number {
  return 60 / score.bpm / score.ticksPerBeat;
}

/** 曲全体の長さ（ティック）。末尾のノートの終わりまで */
export function scoreLengthTicks(score: Score): number {
  let end = 0;
  for (const track of score.tracks) {
    for (const note of track.notes) {
      end = Math.max(end, note.tick + note.durationTicks);
    }
  }
  // 小節の切れ目まで伸ばす（ループの継ぎ目を自然にする）
  const ticksPerBar = score.ticksPerBeat * score.beatsPerBar;
  return Math.ceil(end / ticksPerBar) * ticksPerBar;
}

/** MIDI ノート番号 → 周波数（Hz）。A4 = 69 = 440Hz */
export function pitchToFrequency(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

/**
 * [fromTick, toTick) に始まるノートを列挙する。
 * ループを跨ぐ場合は呼び出し側が範囲を分割する（ここでは折り返さない）。
 */
export function notesInRange(track: Track, fromTick: number, toTick: number): Note[] {
  return track.notes.filter((note) => note.tick >= fromTick && note.tick < toTick);
}

/** 役割でトラックを引く。無ければ undefined */
export function trackOf(score: Score, role: TrackRole): Track | undefined {
  return score.tracks.find((track) => track.role === role);
}
