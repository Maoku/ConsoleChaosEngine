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
    expect(manifest.atlases).toEqual([
      { url: 'assets/gen1/sprites/cars.png', columns: 3, rows: 2 },
      { url: 'assets/gen2/sprites/cars.png', columns: 3, rows: 2 },
    ]);
    expect(manifest.textures.map((asset) => asset.url)).toContain(RACING_FALLBACK_TEXTURE);
    expect(manifest.textures.map((asset) => asset.url)).toEqual(expect.arrayContaining([
      'assets/gen1/backgrounds/coast.png',
      'assets/gen1/road/road.png',
      'assets/gen2/backgrounds/coast.png',
      'assets/gen2/tiles/circuit.png',
    ]));
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
