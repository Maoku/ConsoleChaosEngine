import { describe, expect, it } from 'vitest';
import {
  GEN3_ORDERING_TABLE_LENGTH,
  assertHardwareBlendGenerations,
  assertOrderingTableIndex,
  assertPolygonSortRange,
  blendGen2ColorMath,
  blendGen3Semitransparency,
  blendGen4Gs,
  createOrderingTableWorkspace,
  createRenderFrame,
  defaultOrderingTableIndex,
  generationSupportsHardwareBlend,
  orderingTableIndexForDepth,
  renderFrameSnapshot,
  visitOrderingTable,
} from '../src';
import { HARDWARE_GENERATION_PROFILES } from '../src/generation/profiles';

function expectColor(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index]).toBeCloseTo(expected[index] ?? 0);
  }
}

describe('generation translucency profiles', () => {
  it('declares distinct capabilities and sprite composition for all generations', () => {
    expect(HARDWARE_GENERATION_PROFILES.FC.video.translucency.kind).toBe('none');
    expect(HARDWARE_GENERATION_PROFILES.SFC.video.translucency.kind).toBe('color-math');
    expect(HARDWARE_GENERATION_PROFILES.PS1.video.translucency).toMatchObject({
      kind: 'fixed-rate', orderingTableLength: GEN3_ORDERING_TABLE_LENGTH,
    });
    expect(HARDWARE_GENERATION_PROFILES.PS2.video.translucency.kind).toBe('gs-alpha');
    expect(HARDWARE_GENERATION_PROFILES.FC.video.spriteComposition).toBe('separate-plane');
    expect(HARDWARE_GENERATION_PROFILES.SFC.video.spriteComposition).toBe('separate-plane');
    expect(HARDWARE_GENERATION_PROFILES.PS1.video.spriteComposition).toBe('scene');
    expect(HARDWARE_GENERATION_PROFILES.PS2.video.spriteComposition).toBe('scene');
  });

  it('keeps the empty render-frame snapshot unchanged when new fields are omitted', () => {
    expect(renderFrameSnapshot(createRenderFrame())).toEqual({
      timeSeconds: 0,
      camera: { projection: 'orthographic', position: [0, 20, 0], target: [0, 0, 0], zoom: 16 },
      meshes: [],
      skinnedMeshes: [],
      sprites: [],
      lights: [],
      backgrounds: [],
      overlays: [],
      materials: [],
    });
  });
});

describe('CPU blend references', () => {
  it('models Gen2 add/subtract, half result, fixed color, and RGB555 rounding', () => {
    expectColor(blendGen2ColorMath([0.25, 0.5, 0.75], [0.5, 0.5, 0.5], {
      family: 'gen2-color-math', operation: 'add', half: true,
    }), [12 / 31, 16 / 31, 20 / 31]);
    expectColor(blendGen2ColorMath([0.25, 0.25, 0.25], [0.75, 0.5, 0.25], {
      family: 'gen2-color-math', operation: 'subtract', half: false,
    }), [15 / 31, 8 / 31, 0]);
    expectColor(blendGen2ColorMath([1, 1, 1], [0.5, 0.5, 0.5], {
      family: 'gen2-color-math', operation: 'add', half: false, operand: 'fixed', fixedColor: [0.25, 0, 0],
    }), [24 / 31, 16 / 31, 16 / 31]);
  });

  it('models and clamps all four Gen3 fixed-rate modes', () => {
    const source = [0.8, 0.4, 0.2] as const;
    const destination = [0.4, 0.4, 0.4] as const;
    expectColor(blendGen3Semitransparency(source, destination, 'average'), [0.6, 0.4, 0.3]);
    expectColor(blendGen3Semitransparency(source, destination, 'add'), [1, 0.8, 0.6]);
    expectColor(blendGen3Semitransparency(source, destination, 'subtract'), [0, 0, 0.2]);
    expectColor(blendGen3Semitransparency(source, destination, 'quarter-add'), [0.6, 0.5, 0.45]);
  });

  it('models representative Gen4 source, fixed alpha, add, subtract, and multiply presets', () => {
    const source = [0.8, 0.4, 0.2, 0.5] as const;
    const destination = [0.2, 0.4, 0.8, 1] as const;
    expectColor(blendGen4Gs(source, destination, 'source-over'), [0.5, 0.4, 0.5, 1]);
    expectColor(blendGen4Gs(source, destination, 'fixed-alpha', 0.25), [0.35, 0.4, 0.65, 1]);
    expectColor(blendGen4Gs(source, destination, 'add'), [0.6, 0.6, 0.9, 1]);
    expectColor(blendGen4Gs(source, destination, 'subtract'), [0, 0.2, 0.7, 1]);
    expectColor(blendGen4Gs(source, destination, 'multiply'), [0.18, 0.28, 0.48, 1]);
  });

  it('rejects generation-specific families on conflicting generation masks and disables Gen1 blending', () => {
    expect(() => assertHardwareBlendGenerations(['SFC', 'PS1'], {
      family: 'gen2-color-math', operation: 'add', half: false,
    })).toThrow(/PS1/);
    expect(generationSupportsHardwareBlend('FC', { family: 'portable', operation: 'alpha' })).toBe(false);
  });
});

describe('Gen3 ordering table primitives', () => {
  it('preallocates exactly 12 reusable lists and visits index 0 through 11', () => {
    const table = createOrderingTableWorkspace<string>();
    expect(table.lists).toHaveLength(12);
    const lists = table.lists;
    for (let index = 0; index < 12; index++) table.lists[index]!.push(String(index));
    const visited: string[] = [];
    visitOrderingTable(table, (packet, index) => visited.push(`${index}:${packet}`));
    expect(visited).toEqual(Array.from({ length: 12 }, (_, index) => `${index}:${index}`));
    table.reset();
    expect(table.lists).toBe(lists);
    expect(table.lists.every((list) => list.length === 0)).toBe(true);
  });

  it('maps view depth from far slot 1 to near slot 8 and reserves effect/UI/debug slots', () => {
    expect(orderingTableIndexForDepth(100, 0, 100)).toBe(1);
    expect(orderingTableIndexForDepth(0, 0, 100)).toBe(8);
    expect(defaultOrderingTableIndex({ kind: 'world', translucent: true, viewDepth: 10, nearDepth: 0, farDepth: 100 })).toBe(9);
    expect(defaultOrderingTableIndex({ kind: 'screen-space', translucent: false, viewDepth: 0, nearDepth: 0, farDepth: 100 })).toBe(10);
    expect(defaultOrderingTableIndex({ kind: 'debug', translucent: false, viewDepth: 0, nearDepth: 0, farDepth: 100 })).toBe(11);
  });

  it('rejects invalid index and descending range values', () => {
    expect(() => assertOrderingTableIndex(12)).toThrow(RangeError);
    expect(() => assertOrderingTableIndex(1.5)).toThrow(RangeError);
    expect(() => assertPolygonSortRange([8, 1])).toThrow(RangeError);
  });
});
