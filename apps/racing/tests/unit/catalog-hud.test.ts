import { describe, expect, it } from 'vitest';
import { GENERATION_IDS } from '@console-chaos/engine';
import { createRaceState } from '@racing/gameplay/race';
import { createRacingRenderManifest, RACING_FALLBACK_TEXTURE } from '@racing/presentation/catalog';
import { formatRaceTime, hudModelFromRace } from '@racing/ui/hud';

describe('Racing production presentation bootstrap', () => {
  it('preloads a public runtime manifest for every generation', () => {
    const manifest = createRacingRenderManifest();
    expect(manifest.models).toEqual([]);
    expect(manifest.geometries).toEqual([{ kind: 'box' }]);
    expect(manifest.textures.map((asset) => asset.url)).toContain(RACING_FALLBACK_TEXTURE);
    for (const generation of GENERATION_IDS) {
      expect(manifest.fallbackTextures[generation]).toBe(RACING_FALLBACK_TEXTURE);
    }
    expect(JSON.stringify(manifest)).not.toContain('/data/');
  });

  it('projects race state into compact DOM HUD text', () => {
    const state = createRaceState();
    expect(hudModelFromRace(state, 'FC')).toMatchObject({
      generationLabel: 'CH 1 / 8-BIT',
      lapText: 'LAP 1/3',
      rankText: 'P1/2',
      countdownText: '3',
      restartVisible: false,
    });
    expect(formatRaceTime(65.125)).toBe('1:05.13');
  });
});
