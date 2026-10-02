import { describe, expect, it } from 'vitest';
import { createFdsSource, FDS_WAVE, FDS_MOD, fdsPitch, fdsModCounter, renderFds, createGenerationAudioService, HARDWARE_GENERATION_PROFILES, scoreLengthTicks } from '@console-chaos/engine';
import { JOURNEY_SCORES } from '@/audio/journey';
import { createFakeAudio } from './fake_audio';

describe('FDS option', () => {
  it('uses a 64 x 6-bit wave and quantized pitch with signed modulator wrap/reset', () => {
    expect(FDS_WAVE).toHaveLength(64);
    expect(FDS_WAVE.every(v => Number.isInteger(v) && v >= 0 && v < 64)).toBe(true);
    expect(FDS_MOD).toHaveLength(32);
    expect(fdsPitch(440)).toBe(1031);
    expect(fdsModCounter(63, 1)).toBe(-64);
    expect(fdsModCounter(-64, 7)).toBe(63);
    expect(fdsModCounter(51, 4)).toBe(0);
  });
  for (const rate of [44100,48000]) it(`renders deterministic bounded PCM at ${rate}`, () => {
    const data = renderFds(440, 1, rate);
    expect(data).toEqual(renderFds(440,1,rate));
    expect(data.every(v => Number.isFinite(v) && Math.abs(v) < 0.08)).toBe(true);
    expect(renderFds(440,1,rate,0).every(v => v === 0)).toBe(true);
    expect(renderFds(440,1,rate,2)).toEqual(data);
  });
  it('cuts the previous expansion note at the next start and stops future notes on disposal', () => {
    const fake = createFakeAudio();
    const fds = createFdsSource(fake.context, fake.context.destination);
    fds.play({role:'lead',frequency:440,when:0,durationSeconds:2,velocity:1});
    fds.play({role:'lead',frequency:660,when:0.5,durationSeconds:2,velocity:1});
    expect(fake.sources[0]!.stoppedAt).toBe(0.5);
    expect(fake.sources[1]!.startedAt).toBe(0.5);
    fds.dispose();
    expect(fake.sources.every(source => source.stoppedAt !== null)).toBe(true);
  });
  it('keeps Gen2+ isolated and reuses sources through 100 switches', () => {
    const fake = createFakeAudio();
    const audio = createGenerationAudioService(fake.context as AudioContext, JOURNEY_SCORES[0]!);
    audio.setGenerationProfile(HARDWARE_GENERATION_PROFILES.FC);
    audio.playScore(JOURNEY_SCORES[0]!);
    fake.advance(1);
    const tick = audio.engine.clock.tickAt(1);
    for(let i=0;i<100;i++) {
      audio.setGen1Expansion!(true);
      audio.setGenerationProfile(HARDWARE_GENERATION_PROFILES.FC);
      expect(audio.currentSourceKey).toBe('psg-fds');
      audio.setGenerationProfile(HARDWARE_GENERATION_PROFILES.SFC);
      expect(audio.currentSourceKey).toBe('brr');
      audio.setGen1Expansion!(false);
      expect(audio.currentSourceKey).toBe('brr');
    }
    expect(audio.engine.clock.tickAt(1)).toBeCloseTo(tick);
    expect(fake.nodeCounts.gain).toBeLessThan(30);
  });
  it('composes pause reasons and never starts on a settings click before play', () => {
    const fake = createFakeAudio();
    const audio = createGenerationAudioService(fake.context as AudioContext, JOURNEY_SCORES[0]!);
    audio.setPaused!(false);
    expect(audio.engine.clock.playing).toBe(false);
    audio.playScore(JOURNEY_SCORES[0]!);
    fake.advance(2);
    const tick = audio.engine.clock.tickAt(2);
    audio.setPaused!(true);
    audio.setPaused!(true,'visibility');
    fake.advance(3);
    audio.setPaused!(false);
    expect(audio.engine.clock.playing).toBe(false);
    audio.setPaused!(false,'visibility');
    expect(audio.engine.clock.tickAt(5)).toBeCloseTo(tick);
  });
  it('writes four full 32-bar suites with non-overlapping lead notes', () => {
    for(const score of JOURNEY_SCORES) {
      expect(scoreLengthTicks(score)).toBe(512);
      const lead=score.tracks[0]!.notes;
      for(let i=1;i<lead.length;i++) expect(lead[i]!.tick).toBeGreaterThanOrEqual(lead[i-1]!.tick+lead[i-1]!.durationTicks);
    }
  });
});
