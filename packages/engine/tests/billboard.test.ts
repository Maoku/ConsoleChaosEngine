import { describe, expect, it } from 'vitest';
import { mat4 } from 'gl-matrix';
import { spriteDepthWrite, writeSpriteModelMatrix } from '../src/render/billboard';
import type { SpriteCommand } from '../src/render/frame';

const sprite = (billboard: NonNullable<SpriteCommand['billboard']>, screenSpace = false): SpriteCommand => ({
  id: 'sprite',
  position: [1, 2, 3],
  size: [4, 6],
  color: '#ffffff',
  billboard,
  screenSpace,
});

describe('sprite billboard matrices', () => {
  it('keeps cylindrical Y upright while facing the camera horizontally', () => {
    const matrix = writeSpriteModelMatrix(mat4.create(), sprite('cylindrical'), [6, 20, 8]);
    const forwardLength = Math.hypot(matrix[8]!, matrix[10]!);
    expect(matrix[8]! / forwardLength).toBeCloseTo(Math.SQRT1_2);
    expect(matrix[9]).toBe(0);
    expect(matrix[10]! / forwardLength).toBeCloseTo(Math.SQRT1_2);
    expect([matrix[4], matrix[5], matrix[6]]).toEqual([0, 3, 0]);
  });

  it('faces the camera vertically and horizontally in spherical mode', () => {
    const matrix = writeSpriteModelMatrix(mat4.create(), sprite('spherical'), [4, 6, 15]);
    const expected = [3, 4, 12];
    const length = Math.hypot(...expected);
    expect(matrix[8]).toBeCloseTo(expected[0]! / length);
    expect(matrix[9]).toBeCloseTo(expected[1]! / length);
    expect(matrix[10]).toBeCloseTo(expected[2]! / length);
  });

  it('leaves none and screen-space sprites in the command plane', () => {
    const none = writeSpriteModelMatrix(mat4.create(), sprite('none'), [20, 20, 20]);
    const screen = writeSpriteModelMatrix(mat4.create(), sprite('spherical', true), [20, 20, 20]);
    expect([none[8], none[9], none[10]]).toEqual([0, 0, 1]);
    expect([screen[8], screen[9], screen[10]]).toEqual([0, 0, 1]);
    expect([screen[12], screen[13], screen[14]]).toEqual([1, 2, 3]);
    expect([none[4], none[5], none[6]]).toEqual([0, 3, 0]);
    expect(screen[4]).toBeCloseTo(0);
    expect(screen[5]).toBeCloseTo(-3);
    expect(screen[6]).toBeCloseTo(0);
  });

  it('defaults world sprites to cylindrical and enforces depth-write rules', () => {
    const command: SpriteCommand = {
      id: 'default', position: [1, 2, 3], size: [4, 6], color: '#ffffff',
    };
    const matrix = writeSpriteModelMatrix(mat4.create(), command, [6, 20, 8]);
    expect(matrix[8]).toBeCloseTo(Math.SQRT1_2);
    expect(spriteDepthWrite(command, false)).toBe(true);
    expect(spriteDepthWrite({ ...command, depthWrite: false }, false)).toBe(false);
    expect(spriteDepthWrite(command, true)).toBe(false);
    expect(spriteDepthWrite({ ...command, screenSpace: true }, false)).toBe(false);
  });
});
