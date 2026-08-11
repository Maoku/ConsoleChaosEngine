import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  scoreLengthTicks,
} from '@console-chaos/engine';
import { createRecordingAudioService } from '@console-chaos/engine-testkit';
import { describe, expect, it } from 'vitest';
import { createRacingAudioPresenter } from '@racing/audio/presenter';
import { createVehicleSoundScheduler, vehicleFrequency } from '@racing/audio/vehicle-sound';
import { arrangeRacingScore } from '@racing/content/audio/arrangements';
import { racingCueRequests } from '@racing/content/audio/cues';
import { RACING_MASTER_SCORE } from '@racing/content/audio/score';

const profile = (id: (typeof GENERATION_IDS)[number]) => HARDWARE_GENERATION_PROFILES[id];

describe('Racing generation audio presentation', () => {
  it('keeps tempo, bar structure, and loop length across four arrangements', () => {
    const arrangements = GENERATION_IDS.map((id) => arrangeRacingScore(profile(id), RACING_MASTER_SCORE));
    expect(scoreLengthTicks(RACING_MASTER_SCORE)).toBe(128);
    expect(arrangements.map(scoreLengthTicks)).toEqual([128, 128, 128, 128]);
    expect(arrangements.map((score) => score.tracks.length)).toEqual([3, 4, 5, 6]);
    expect(arrangements.every((score) => (
      score.bpm === 132 && score.ticksPerBeat === 4 && score.beatsPerBar === 4
    ))).toBe(true);
    for (const score of arrangements) {
      for (let tick = 0; tick < 32; tick++) {
        const active = score.tracks.flatMap((track) => track.notes)
          .filter((note) => note.tick <= tick && note.tick + note.durationTicks > tick);
        expect(active.length, `silent arrangement tick ${tick}`).toBeGreaterThan(0);
        expect(active.reduce((sum, note) => sum + note.velocity, 0)).toBeLessThan(8);
      }
    }
  });

  it('maps stopped, middle, and maximum speed to generation-appropriate frequencies', () => {
    expect([0, 12.5, 25].map((speed) => vehicleFrequency(speed, profile('FC')))).toEqual([87.5, 175, 275]);
    expect([0, 12.5, 25].map((speed) => vehicleFrequency(speed, profile('PS2')))).toEqual([82, 217, 352]);
  });

  it('uses bounded overlap cadence and deterministic brake hysteresis', () => {
    const scheduler = createVehicleSoundScheduler();
    const base = { tick: 0, playerSpeed: 10, throttle: 0.5, brake: 0, opponents: [] } as const;
    const firstBrake = scheduler.update({ ...base, brake: 0.7 }, profile('FC'), 1);
    expect(firstBrake).toHaveLength(2);
    expect(scheduler.update({ ...base, tick: 1, brake: 0.7 }, profile('FC'), 1.01)).toHaveLength(0);
    scheduler.update({ ...base, tick: 2, brake: 0.2 }, profile('FC'), 1.02);
    expect(scheduler.update({ ...base, tick: 3, brake: 0.7 }, profile('FC'), 1.03)).toHaveLength(1);
    scheduler.reset();
    let engineRequests = 0;
    for (let tick = 0; tick < 60; tick++) {
      engineRequests += scheduler.update({ ...base, tick }, profile('FC'), tick / 60).length;
    }
    expect(engineRequests).toBe(12);
  });

  it('preserves bar position through all twelve directed generation switches', () => {
    for (const from of GENERATION_IDS) {
      for (const to of GENERATION_IDS) {
        if (from === to) continue;
        const audio = createRecordingAudioService(132);
        const presenter = createRacingAudioPresenter(audio, RACING_MASTER_SCORE);
        audio.setGenerationProfile(profile(from));
        presenter.start(profile(from));
        audio.advance(7.375);
        const before = audio.barPosition;
        audio.setGenerationProfile(profile(to));
        presenter.applyGeneration(profile(to));
        expect(Math.abs(audio.barPosition - before)).toBeLessThanOrEqual(1e-9);
        expect(audio.currentSourceKey).toBe(profile(to).audio.synth);
      }
    }
  });

  it('scales race cue layers by capability and makes finish the strongest cue', () => {
    expect(racingCueRequests('finish', profile('FC'), 0)).toHaveLength(1);
    expect(racingCueRequests('finish', profile('SFC'), 0)).toHaveLength(2);
    expect(racingCueRequests('finish', profile('PS2'), 0)).toHaveLength(4);
    expect(racingCueRequests('finish', profile('PS2'), 0)[0]?.velocity)
      .toBeGreaterThan(racingCueRequests('lap', profile('PS2'), 0)[0]?.velocity ?? 0);
  });
});
