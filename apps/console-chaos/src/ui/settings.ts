/**
 * 設定（T3-06 で画面を作る。BR-05 はその**状態と保存だけ**を置く）。
 *
 * 画面を先に作ると BR-05 が T3-06 を巻き取ってしまうので、ここが持つのは
 *   - いま何が入/切か（`DisplayOptions`）
 *   - 再読み込みしても保たれること（`localStorage`）
 *   - CRT プリセットの**部分上書き**への変換（`crtOverride`）
 * の 3 つだけ。操作は当面キー（`main.ts` の `N` / `F`）に割り当ててある。
 * T3-06 で画面へ移すときは、この状態をそのまま読めばよい。
 *
 * **シェーダにもプリセットにも分岐を足さない**（計画 §2 の決定 4）。
 * `crt.ts` は元から `override` を受け取れるようになっていたので、道を繋ぐだけで済む。
 */
import type { CrtPreset } from '@/render/postfx/presets';

export interface DisplayOptions {
  /**
   * 蛍光体マスク（モアレ）。**既定は入**（プリセットどおり）。
   * 切ると `mask: 0`。3 画素周期の縞が内部解像度の拡大と干渉して縞が出る環境向け
   */
  moire: boolean;
  /**
   * 平面化。**既定は切**（プリセットどおりの樽型歪み）。
   * 入にすると `curvature: 0` で `curve()` が素通しになる（シェーダは変更しない）
   */
  flatten: boolean;
}

export const DEFAULT_DISPLAY_OPTIONS: DisplayOptions = { moire: true, flatten: false };

/** 保存の鍵。プレイテストの記録（`debug/playtest_log.ts`）と混ざらない名前にする */
export const DISPLAY_STORAGE_KEY = 'chaos.display';

/** 表示名。キーの案内（`debug/playtest_hud.ts`）と一時表示が同じ言葉を使う */
export const DISPLAY_LABELS: Record<keyof DisplayOptions, string> = {
  moire: 'モアレ',
  flatten: '平面化',
};

export interface DisplaySettings {
  readonly options: Readonly<DisplayOptions>;
  /** 切り替えて保存し、切り替えた後の値を返す */
  toggle(key: keyof DisplayOptions): boolean;
  /**
   * CRT プリセットへの部分上書き。**既定のままの項目は返さない**ので、
   * 何も変えていなければ空になり、プリセットがそのまま通る
   */
  crtOverride(): Partial<CrtPreset>;
}

/**
 * 保存先。`localStorage` が使えない環境（テスト・プライベートモード）でも
 * ゲームが動くことを優先し、読めなければ既定値、書けなければ黙って諦める。
 */
function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadDisplayOptions(storage: Storage | null = defaultStorage()): DisplayOptions {
  const raw = storage?.getItem(DISPLAY_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_DISPLAY_OPTIONS };
  try {
    const stored = JSON.parse(raw) as Partial<DisplayOptions>;
    return {
      moire: typeof stored.moire === 'boolean' ? stored.moire : DEFAULT_DISPLAY_OPTIONS.moire,
      flatten: typeof stored.flatten === 'boolean' ? stored.flatten : DEFAULT_DISPLAY_OPTIONS.flatten,
    };
  } catch {
    // 壊れた保存は既定値へ倒す。ここで落とすと設定 1 つでゲームが起動しなくなる
    return { ...DEFAULT_DISPLAY_OPTIONS };
  }
}

export function createDisplaySettings(storage: Storage | null = defaultStorage()): DisplaySettings {
  const options = loadDisplayOptions(storage);

  function save(): void {
    try {
      storage?.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(options));
    } catch {
      // 保存できなくても、そのセッションの間は設定が効く
    }
  }

  return {
    options,
    toggle(key): boolean {
      options[key] = !options[key];
      save();
      return options[key];
    },
    crtOverride(): Partial<CrtPreset> {
      const override: Partial<CrtPreset> = {};
      if (!options.moire) override.mask = 0;
      if (options.flatten) override.curvature = 0;
      return override;
    },
  };
}
