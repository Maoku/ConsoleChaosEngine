import { describe, expect, it } from 'vitest';
import { GENERATION_IDS, HARDWARE_GENERATION_PROFILES, MASTER_PALETTE_RGB } from '@console-chaos/engine';
import { defineAssetClass, deriveGenerationAssetSpec } from '../src/index';

describe('generation asset specs', () => {
  it('derives capability values only from engine profiles', () => {
    for (const generation of GENERATION_IDS) {
      const spec = deriveGenerationAssetSpec(generation);
      const video = HARDWARE_GENERATION_PROFILES[generation].video;
      expect(spec.internalWidth).toBe(video.internalWidth);
      expect(spec.internalHeight).toBe(video.internalHeight);
      expect(spec.paletteMode).toBe(video.paletteMode);
      expect(spec.paletteBlockSize).toBe(video.paletteBlockSize);
      expect(spec.tileSnap).toBe(video.tileSnap);
      expect(spec.textureFilter).toBe(video.textureFilter);
      expect(spec.binaryAlpha).toBe(video.translucency.kind !== 'gs-alpha');
    }
    expect(deriveGenerationAssetSpec('FC').masterPalette).toBe(MASTER_PALETTE_RGB);
    expect(deriveGenerationAssetSpec('SFC').rgb555).toBe(true);
  });

  it('keeps per-asset color budgets and target layout in the consumer definition', () => {
    const portrait = defineAssetClass({
      id: 'portrait',
      colorBudget: { FC: 4, SFC: 15, PS1: 256, PS2: null },
      targetSize: (generation) => ({ FC: 32, SFC: 48, PS1: 64, PS2: 128 })[generation],
    });
    expect(portrait.specFor('FC')).toMatchObject({ width: 32, height: 32, colorBudget: 4, internalWidth: 256 });
    expect(portrait.specFor('PS2')).toMatchObject({ width: 128, height: 128, colorBudget: null, internalWidth: 640 });
  });
});
