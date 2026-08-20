/** 謎の名称と固有ヒントをまとめた、画面表示用コピーの正本。 */
export interface PuzzleCatalogEntry {
  name: string;
  hints: {
    /** 段階 3：使っている制約を明示する（解法は言わない） */
    stage3: string;
    /** 段階 4：解法の直接提示 */
    stage4: string;
  };
}

/** `{channels}` はレベルの requiredGenerations から作ったチャンネル名へ置き換わる。 */
export const PUZZLE_CATALOG: Readonly<Record<string, PuzzleCatalogEntry>> = {
  'F-1': {
    name: '色の潰れ',
    hints: {
      stage3: '色の選択肢が少ない世代では、近い色どうしが同じ 1 色として扱われる。装置はそれを 1 本の物として扱う',
      stage4: '{channels} ではツタが橋になる。色が潰れる世代では 2 本が撚られて太くなり、いちばん楽に渡って行ける',
    },
  },
  'F-2': {
    name: 'ちらつきの隙間',
    hints: {
      stage3: '1 本の走査線に並べられる数には上限がある。あふれた分は表示されない',
      stage4: '{channels} では群れがあふれてちらつく。裂け目から覗く灯、その真下の石だけを踏む',
    },
  },
  'S-1': {
    name: '回る床',
    hints: {
      stage3: '床を 1 枚の面として回せる世代がある。回るのは模様だけではなく、面の上にあるものすべて',
      stage4: '{channels} で床が回り、向こう岸の島が近づく。半透明の踏み台から島へ乗って運ばれる',
    },
  },
  'P1-1': {
    name: '裏側',
    hints: {
      stage3: '奥行きが潰れている世代では、手前にある壁を避けようがない',
      stage4: '{channels} で壁の奥側へ回り込み、裏のスイッチに触れる',
    },
  },
  'P1-2': {
    name: 'ソートの破れ',
    hints: {
      stage3: '奥行きを描画順で解決している世代では、重なりの矛盾がそのまま通り抜けになる',
      stage4: '{channels} で殻の継ぎ目に入り、内部の核に触れる',
    },
  },
  'P2-1': {
    name: '暗闇と松明',
    hints: {
      stage3: '動く光を持つ世代だけが、暗闇の中で足元を照らせる',
      stage4: '{channels} では松明が灯る。照らしながら渡り廊下の折れを追い、突き当りの刻印を踏む',
    },
  },
};

/** 保存形式は ID のまま保ち、表示時だけ人が読める名称を付ける。 */
export function puzzleDisplayLabel(puzzleId: string): string {
  const name = PUZZLE_CATALOG[puzzleId]?.name;
  return name ? `${puzzleId} ${name}` : puzzleId;
}

export interface PuzzleCatalogIssue {
  puzzleId: string;
  message: string;
}

/** レベルに配置された謎の表示情報が完全かを CI から検査する。 */
export function checkPuzzleCatalog(puzzleIds: readonly string[]): PuzzleCatalogIssue[] {
  const issues: PuzzleCatalogIssue[] = [];
  for (const puzzleId of puzzleIds) {
    const entry = PUZZLE_CATALOG[puzzleId];
    if (!entry) {
      issues.push({ puzzleId, message: '名称・段階 3・4 ヒントがカタログに未登録' });
      continue;
    }
    if (entry.name.trim() === '') issues.push({ puzzleId, message: '名称が空' });
    if (entry.hints.stage3.trim() === '') issues.push({ puzzleId, message: '段階 3 ヒントが空' });
    if (entry.hints.stage4.trim() === '') issues.push({ puzzleId, message: '段階 4 ヒントが空' });
  }
  return issues;
}
