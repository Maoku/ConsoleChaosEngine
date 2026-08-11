import { describe, expect, it } from 'vitest';
import { GENERATION_IDS, HARDWARE_GENERATION_PROFILES } from '@console-chaos/engine';
import { RACING_THEMES } from '@racing/config/themes';

describe('four racing generations', () => {
  it('defines complete visual/input/audio variants for every hardware profile', () => {
    for (const generation of GENERATION_IDS) {
      expect(RACING_THEMES[generation].label).toContain('CH ');
      expect(HARDWARE_GENERATION_PROFILES[generation].video.internalWidth).toBeGreaterThan(0);
      expect(HARDWARE_GENERATION_PROFILES[generation].audio.channels).toBeGreaterThan(0);
    }
    expect(new Set(GENERATION_IDS.map((generation) => RACING_THEMES[generation].cameraZoom)).size).toBe(4);
  });
});

