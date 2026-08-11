/**
 * 表示設定（BR-05）。
 *
 * ここが守るのは 2 つだけ。**既定はプリセットどおり**であること（何も設定していない
 * プレイヤーの見えを変えない）と、**再読み込みしても保たれる**こと。
 */
import { describe, it, expect } from 'vitest';
import {
  createDisplaySettings,
  DEFAULT_DISPLAY_OPTIONS,
  DISPLAY_STORAGE_KEY,
  loadDisplayOptions,
} from '@/ui/settings';

/** localStorage の最小の代役（テスト環境は DOM を持たない） */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe('表示設定（BR-05）', () => {
  it('既定はモアレ入・平面化切（プリセットどおりの見え）', () => {
    expect(DEFAULT_DISPLAY_OPTIONS).toEqual({ moire: true, flatten: false });
    // 既定のままなら上書きは空。プリセットに一切触れない
    expect(createDisplaySettings(fakeStorage()).crtOverride()).toEqual({});
  });

  it('モアレを切ると蛍光体マスクだけを 0 にする', () => {
    const settings = createDisplaySettings(fakeStorage());
    expect(settings.toggle('moire')).toBe(false);
    expect(settings.crtOverride()).toEqual({ mask: 0 });
  });

  it('平面化を入れると樽型歪みだけを 0 にする', () => {
    const settings = createDisplaySettings(fakeStorage());
    expect(settings.toggle('flatten')).toBe(true);
    expect(settings.crtOverride()).toEqual({ curvature: 0 });
  });

  it('2 つは独立に効く', () => {
    const settings = createDisplaySettings(fakeStorage());
    settings.toggle('moire');
    settings.toggle('flatten');
    expect(settings.crtOverride()).toEqual({ mask: 0, curvature: 0 });
  });

  it('切替が保存され、読み直しても保たれる', () => {
    const storage = fakeStorage();
    createDisplaySettings(storage).toggle('flatten');
    expect(loadDisplayOptions(storage)).toEqual({ moire: true, flatten: true });
    expect(createDisplaySettings(storage).options.flatten).toBe(true);
  });

  it('壊れた保存や保存先が無い環境では既定へ倒す（設定 1 つで起動しなくならない）', () => {
    expect(loadDisplayOptions(fakeStorage({ [DISPLAY_STORAGE_KEY]: '{' }))).toEqual(
      DEFAULT_DISPLAY_OPTIONS,
    );
    expect(loadDisplayOptions(fakeStorage({ [DISPLAY_STORAGE_KEY]: '{"moire":"yes"}' }))).toEqual(
      DEFAULT_DISPLAY_OPTIONS,
    );
    expect(loadDisplayOptions(null)).toEqual(DEFAULT_DISPLAY_OPTIONS);
    expect(() => createDisplaySettings(null).toggle('moire')).not.toThrow();
  });
});
