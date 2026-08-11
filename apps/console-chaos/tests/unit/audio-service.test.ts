import { describe, expect, it } from 'vitest';
import { HARDWARE_GENERATION_PROFILES, createGenerationAudioService } from '@console-chaos/engine';
import { arrangeFor } from '@/audio/music';
import { songOf } from '@/audio/songs';
import { createFakeAudio } from './fake_audio';

describe('generation audio service lifecycle', () => {
  it('resumes from the exact music tick captured before mute', () => {
    const fake = createFakeAudio();
    const score = arrangeFor(HARDWARE_GENERATION_PROFILES.SFC, songOf('pop').score);
    const audio = createGenerationAudioService(fake.context as AudioContext, score);
    audio.setGenerationProfile(HARDWARE_GENERATION_PROFILES.SFC);
    audio.playScore(score);
    fake.advance(2.125);
    const before = audio.engine.clock.tickAt(fake.context.currentTime);

    audio.setMuted(true);
    fake.advance(4.75);
    audio.setMuted(false);

    expect(audio.engine.clock.tickAt(fake.context.currentTime)).toBeCloseTo(before, 9);
  });

  it('keeps a song change made while muted and restarts it from tick zero', () => {
    const fake = createFakeAudio();
    const pop = arrangeFor(HARDWARE_GENERATION_PROFILES.PS1, songOf('pop').score);
    const calm = arrangeFor(HARDWARE_GENERATION_PROFILES.PS1, songOf('calm').score);
    const audio = createGenerationAudioService(fake.context as AudioContext, pop);
    audio.setGenerationProfile(HARDWARE_GENERATION_PROFILES.PS1);
    audio.playScore(pop);
    fake.advance(1.25);
    audio.setMuted(true);
    audio.playScore(calm, 0);
    fake.advance(3);
    audio.setMuted(false);

    expect(audio.engine.clock.score.bpm).toBe(calm.bpm);
    expect(audio.engine.clock.tickAt(fake.context.currentTime)).toBe(0);
  });
});
