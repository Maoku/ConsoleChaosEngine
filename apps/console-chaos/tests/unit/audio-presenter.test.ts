import { describe, expect, it } from 'vitest';
import { HARDWARE_GENERATION_PROFILES } from '@console-chaos/engine';
import { createRecordingAudioService } from '@console-chaos/engine-testkit';
import { createConsoleAudioPresenter } from '@/audio/presenter';
import { songOf } from '@/audio/songs';

describe('Console generic audio presenter', () => {
  it('maps Console song/SFX content onto the engine AudioService API', () => {
    const service = createRecordingAudioService();
    const presenter = createConsoleAudioPresenter(service, songOf(null).score);
    presenter.start(HARDWARE_GENERATION_PROFILES.FC);
    presenter.applyGeneration(HARDWARE_GENERATION_PROFILES.PS2);
    presenter.playSfx('jump', HARDWARE_GENERATION_PROFILES.PS2);
    expect(service.tones.length).toBeGreaterThan(0);
    expect(service.barPosition).toBe(0);
  });
});
