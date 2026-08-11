import { describe, expect, it } from 'vitest';
import { HARDWARE_GENERATION_PROFILES } from '@console-chaos/engine';
import { createRecordingAudioService } from '@console-chaos/engine-testkit';
import { createConsoleAudioPresenter } from '@/audio/presenter';
import { bgmStatusText, createBgmControl } from '@/debug/bgm_control';
import { songOf, type SongId } from '@/audio/songs';
import type { AudioService, Score } from '@console-chaos/engine';

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

  it('restarts a newly selected song at its first tick using the active arrangement', () => {
    const base = createRecordingAudioService();
    const starts: Array<{ score: Score; fromTick: number }> = [];
    const service: AudioService = {
      ...base,
      playScore: (score, fromTick = 0) => starts.push({ score, fromTick }),
    };
    const presenter = createConsoleAudioPresenter(service, songOf('pop').score);
    presenter.start(HARDWARE_GENERATION_PROFILES.PS1, 12);
    presenter.changeSong(songOf('calm').score);

    expect(starts.map(({ fromTick }) => fromTick)).toEqual([12, 0]);
    expect(starts.at(-1)?.score.bpm).toBe(songOf('calm').score.bpm);
  });

  it('preserves B/M selection state and forwards mute without owning hardware rules', () => {
    const service = createRecordingAudioService();
    const muteChanges: boolean[] = [];
    const presenter = createConsoleAudioPresenter({
      ...service,
      setMuted: (value) => muteChanges.push(value),
    }, songOf('pop').score);
    presenter.start(HARDWARE_GENERATION_PROFILES.SFC);
    const notices: string[] = [];
    const control = createBgmControl({
      audio: () => presenter,
      songId: 'pop' satisfies SongId,
      onChange: (status) => notices.push(bgmStatusText(status)),
    });

    control.nextSong();
    control.toggleMute();
    expect(control.status).toMatchObject({ songId: 'calm', muted: true });
    expect(muteChanges).toEqual([false, true]);
    expect(notices).toEqual([
      `BGM ${songOf('calm').title}`,
      `BGM 消音 — ${songOf('calm').title}`,
    ]);
  });
});
