/**
 * T1-16「BGM 1 曲 × 4 編曲 + 効果音一式」の検証。
 * 受け入れ条件は「**切替時に位相が保たれる**」。
 *
 * 曲は 2 つある（選曲。`audio/songs.ts`）。**編曲の約束は曲を跨いで同じ**なので、
 * 編曲側の検査は目録の全曲に対して回す。
 */
import { describe, it, expect } from 'vitest';
import { GENERATION_IDS, PROFILES, type GenerationId } from '@/generation/profiles';
import {
  AREA1_SONG_CALM,
  AREA1_SONG_POP,
  arrangeFor,
  maxSimultaneousVoices,
  PERC_HAT,
  PERC_KICK,
  PERC_SNARE,
  sameBarStructure,
  SFX_HEADROOM_VOICES,
} from '@/audio/music';
import { DEFAULT_SONG_ID, nextSongId, songOf, SONGS } from '@/audio/songs';
import { pitchToFrequency, scoreLengthTicks, secondsPerTick } from '@/audio/score';
import { createAudioDirector } from '@/audio/director';
import { bgmStatusText, createBgmControl, type BgmStatus } from '@/debug/bgm_control';
import { phasePreserved } from '@/audio/clock';
import { MAX_SFX_LAYERS, SFX, sfxLayers, sfxRequests, sweepSteps, type SfxId } from '@/audio/sfx';
import { adpcmEncodeDecode } from '@/audio/adpcm_ps1';
import { brrQuantize, BRR_LEVELS } from '@/audio/sampler_sfc';
import { createCueTracker, panOf, pollCues } from '@/gameplay/audio_cues';
import { createFakeAudio } from './fake_audio';
import { loadLevelFile } from './replay/harness';
import { createTestSession, tickSession } from './session-testkit';

describe.each(SONGS.map((song) => [song.title, song.score] as const))(
  'audio/music「%s」（1 曲 × 4 編曲）',
  (_title, song) => {
    const arrangements = GENERATION_IDS.map((id) => [id, arrangeFor(PROFILES[id], song)] as const);

    it('4 編曲はテンポ・拍子・小節数が完全に一致する（位相同期の前提）', () => {
      for (const [, score] of arrangements) {
        expect(sameBarStructure(score, song)).toBe(true);
      }
    });

    it('音の位置（tick）を動かさない — 編曲は引くか重ねるだけ', () => {
      const leadTicks = (score: (typeof arrangements)[number][1]): number[] =>
        score.tracks
          .filter((track) => track.role === 'lead')
          .flatMap((track) => track.notes.map((note) => note.tick))
          .sort((a, b) => a - b);
      const base = leadTicks(song);
      for (const [, score] of arrangements) {
        // ハーモニーが載る世代では同じ tick が 2 回現れるので、集合で比べる
        expect([...new Set(leadTicks(score))]).toEqual(base);
      }
    });

    it('編曲は世代の同時発音数に収まる（効果音の分を空けたうえで）', () => {
      for (const [id, score] of arrangements) {
        const limit = PROFILES[id].audio.channels - SFX_HEADROOM_VOICES;
        expect(maxSimultaneousVoices(score)).toBeLessThanOrEqual(limit);
      }
    });

    it('声が増えるほどパートが増える（第1世代が一番薄い）', () => {
      const counts = arrangements.map(([, score]) => score.tracks.length);
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
      }
      expect(counts[0]).toBeLessThan(counts[counts.length - 1]!);
    });

    it('第1世代の編曲にはパッドが無い（8 声に満たないため）', () => {
      expect(arrangeFor(PROFILES.FC, song).tracks.some((track) => track.role === 'pad')).toBe(false);
      expect(arrangeFor(PROFILES.SFC, song).tracks.some((track) => track.role === 'pad')).toBe(true);
    });

    it('打楽器を拍頭だけに間引いても「キック → スネア」の骨格が残る', () => {
      const perc = arrangeFor(PROFILES.FC, song).tracks.find((track) => track.role === 'perc')!;
      // 拍頭に 2 声重ねていない（第1世代は打楽器に 1 声しか割けない）
      const ticks = perc.notes.map((note) => note.tick);
      expect(new Set(ticks).size).toBe(ticks.length);
      expect(perc.notes.filter((note) => note.pitch === PERC_KICK).length).toBeGreaterThan(0);
      expect(perc.notes.filter((note) => note.pitch === PERC_SNARE).length).toBeGreaterThan(0);
    });

    it('ハーモニーは音階の中に収まる（平行 3 度にすると濁る）', () => {
      // 2 曲ともハ長調 / イ短調で構成音は同じ
      const IN_SCALE = new Set([0, 2, 4, 5, 7, 9, 11]);
      const leads = arrangeFor(PROFILES.PS1, song).tracks.filter((track) => track.role === 'lead');
      expect(leads).toHaveLength(2);
      for (const track of leads) {
        for (const note of track.notes) expect(IN_SCALE.has(note.pitch % 12)).toBe(true);
      }
    });
  },
);

describe('audio/music（曲によらない約束）', () => {
  it('打楽器 3 声はどの音源でも打ち分けられる（再生レートの下限に張り付かない）', () => {
    // 音源の下限は synth_fc が 0.05×440Hz、sampler_sfc / adpcm / stream が 0.25×220Hz
    const FLOOR_HZ = 220 * 0.25;
    const pitches = [PERC_KICK, PERC_SNARE, PERC_HAT];
    for (const pitch of pitches) expect(pitchToFrequency(pitch)).toBeGreaterThan(FLOOR_HZ);
    for (let i = 1; i < pitches.length; i++) {
      const ratio = pitchToFrequency(pitches[i]!) / pitchToFrequency(pitches[i - 1]!);
      expect(ratio).toBeGreaterThan(1.5); // 隣どうしが 1 オクターブ近く離れている
    }
  });

  it('2 曲は別の曲である（テンポも中身も違う）', () => {
    expect(AREA1_SONG_POP.bpm).not.toBe(AREA1_SONG_CALM.bpm);
    expect(sameBarStructure(AREA1_SONG_POP, AREA1_SONG_CALM)).toBe(false);
    // 小節数だけは揃えてある（どちらも 8 小節ループ）
    expect(scoreLengthTicks(AREA1_SONG_POP)).toBe(scoreLengthTicks(AREA1_SONG_CALM));
  });
});

describe('audio/songs（選曲の目録）', () => {
  it('既定の曲が目録にある', () => {
    expect(songOf(DEFAULT_SONG_ID).id).toBe(DEFAULT_SONG_ID);
    expect(SONGS.length).toBeGreaterThanOrEqual(2);
  });

  it('未知の ID は既定の曲に落ちる（URL パラメータが外から来るため）', () => {
    expect(songOf('nope').id).toBe(DEFAULT_SONG_ID);
    expect(songOf(null).id).toBe(DEFAULT_SONG_ID);
  });

  it('巡回すると全曲を通って元へ戻る', () => {
    let id = DEFAULT_SONG_ID;
    const seen = [id];
    for (let i = 1; i < SONGS.length; i++) {
      id = nextSongId(id);
      seen.push(id);
    }
    expect(new Set(seen).size).toBe(SONGS.length);
    expect(nextSongId(id)).toBe(DEFAULT_SONG_ID);
  });

  it('曲名は重複しない（画面に出して見分けられる）', () => {
    expect(new Set(SONGS.map((song) => song.title)).size).toBe(SONGS.length);
  });
});

describe('audio/director（4 世代を通した再生）', () => {
  it('4 世代を往復しても小節位置がずれない（T1-16 の受け入れ条件）', () => {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.FC);

    fake.advance(3.7);
    const bar = director.engine.clock.barAt(fake.context.currentTime);
    for (const id of ['SFC', 'PS1', 'PS2', 'FC', 'PS2', 'SFC'] as GenerationId[]) {
      director.applyProfile(PROFILES[id]);
      const after = director.engine.clock.barAt(fake.context.currentTime);
      expect(phasePreserved(bar, after, 1e-9)).toBe(true);
    }
  });

  it('同じ世代のまま呼び続けても、編曲を作り直さない（毎フレーム呼ばれる）', () => {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.PS2);
    const first = director.engine.clock.score;
    for (let i = 0; i < 10; i++) director.applyProfile(PROFILES.PS2);
    expect(director.engine.clock.score).toBe(first);
  });

  it('世代ごとに音源が差し替わる（合成方式をキーにする）', () => {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.FC);
    expect(director.currentSynth).toBe('psg');
    director.applyProfile(PROFILES.SFC);
    expect(director.currentSynth).toBe('brr');
    director.applyProfile(PROFILES.PS1);
    expect(director.currentSynth).toBe('adpcm');
    director.applyProfile(PROFILES.PS2);
    expect(director.currentSynth).toBe('streaming');
  });

  it('第1世代は発振器で、他はサンプル再生で鳴る', () => {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.FC);
    director.update();
    expect(fake.sources.some((source) => source.kind === 'oscillator')).toBe(true);

    fake.reset();
    fake.advance(0.5);
    director.applyProfile(PROFILES.PS2);
    // 1 回の update が拾う窓は 0.12 秒しかない。音の無い隙間に当たらないよう数拍ぶん回す
    for (let i = 0; i < 10; i++) {
      director.update();
      fake.advance(0.05);
    }
    expect(fake.sources.length).toBeGreaterThan(0);
    expect(fake.sources.every((source) => source.kind === 'buffer')).toBe(true);
  });

  it('残響・定位を持つ世代だけがそのノードを作る', () => {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.FC);
    director.update();
    expect(fake.nodeCounts['convolver'] ?? 0).toBe(0);
    expect(fake.nodeCounts['panner'] ?? 0).toBe(0);

    director.applyProfile(PROFILES.SFC);
    expect(fake.nodeCounts['convolver'] ?? 0).toBeGreaterThan(0);

    director.applyProfile(PROFILES.PS2);
    director.update();
    expect(fake.nodeCounts['panner'] ?? 0).toBeGreaterThan(0);
  });

  it('ループの継ぎ目を越えても予約が続く（曲が 1 周で止まらない）', () => {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.SFC);

    const loopSeconds = scoreLengthTicks(arrangeFor(PROFILES.SFC)) * secondsPerTick(AREA1_SONG_POP);
    // 1 周と少し進める（0.05 秒刻みはゲームループの呼び出し間隔に相当）
    for (let elapsed = 0; elapsed < loopSeconds * 1.2; elapsed += 0.05) {
      director.update();
      fake.advance(0.05);
    }
    fake.reset();
    // 2 周目でも音が予約され続けている
    for (let i = 0; i < 40; i++) {
      director.update();
      fake.advance(0.05);
    }
    expect(fake.sources.length).toBeGreaterThan(0);
  });
});

describe('audio/director（選曲と消音）', () => {
  it('曲を差し替えると編曲もその曲のものになる', () => {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.SFC);
    expect(director.currentSong).toBe(AREA1_SONG_POP);
    expect(director.engine.clock.score.bpm).toBe(AREA1_SONG_POP.bpm);

    director.changeSong(AREA1_SONG_CALM);
    expect(director.currentSong).toBe(AREA1_SONG_CALM);
    expect(director.engine.clock.score.bpm).toBe(AREA1_SONG_CALM.bpm);
    // 編曲規則は曲を跨いで同じ（第2世代はパッドまで）
    expect(director.engine.clock.score.tracks.map((track) => track.role)).toEqual([
      'lead',
      'bass',
      'perc',
      'pad',
    ]);
  });

  it('曲を差し替えたら曲頭から鳴らし直す（テンポが違うので位相は保てない）', () => {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.PS1);
    fake.advance(3.3);
    expect(director.engine.clock.tickAt(fake.context.currentTime)).toBeGreaterThan(0);

    director.changeSong(AREA1_SONG_CALM);
    expect(director.engine.clock.tickAt(fake.context.currentTime)).toBe(0);
    expect(director.engine.clock.playing).toBe(true);
  });

  it('同じ曲を渡し直しても鳴らし直さない（毎フレーム呼ばれても平気）', () => {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.PS2);
    fake.advance(2.5);
    const before = director.engine.clock.tickAt(fake.context.currentTime);
    for (let i = 0; i < 5; i++) director.changeSong(AREA1_SONG_POP);
    expect(director.engine.clock.tickAt(fake.context.currentTime)).toBe(before);
  });

  it('消音すると BGM の予約が止まり、効果音は鳴り続ける', () => {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.SFC);

    director.setMuted(true);
    expect(director.muted).toBe(true);
    fake.reset();
    for (let i = 0; i < 20; i++) {
      director.update();
      fake.advance(0.05);
    }
    expect(fake.sources).toHaveLength(0); // BGM は 1 音も予約されない

    director.playSfx('jump', PROFILES.SFC);
    expect(fake.sources.length).toBeGreaterThan(0); // 効果音は鳴る
  });

  it('消音を戻すと止めた位置から続く', () => {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.SFC);
    fake.advance(2.0);
    const at = director.engine.clock.tickAt(fake.context.currentTime);

    director.setMuted(true);
    fake.advance(5.0); // 止めている間に時間が経つ
    director.setMuted(false);

    expect(director.muted).toBe(false);
    expect(director.engine.clock.playing).toBe(true);
    expect(director.engine.clock.tickAt(fake.context.currentTime)).toBeCloseTo(at, 9);
  });

  it('消音中に曲を替えても鳴り出さない（戻したときに新しい曲が鳴る）', () => {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.PS1);
    director.setMuted(true);
    director.changeSong(AREA1_SONG_CALM);

    fake.reset();
    for (let i = 0; i < 20; i++) {
      director.update();
      fake.advance(0.05);
    }
    expect(fake.sources).toHaveLength(0);

    director.setMuted(false);
    for (let i = 0; i < 20; i++) {
      director.update();
      fake.advance(0.05);
    }
    expect(fake.sources.length).toBeGreaterThan(0);
    expect(director.engine.clock.score.bpm).toBe(AREA1_SONG_CALM.bpm);
  });

  it('消音していても世代切替は効く（戻したときの音源が変わっている）', () => {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.FC);
    director.setMuted(true);
    director.applyProfile(PROFILES.PS2);
    expect(director.currentSynth).toBe('streaming');

    director.setMuted(false);
    for (let i = 0; i < 20; i++) {
      director.update();
      fake.advance(0.05);
    }
    expect(fake.sources.every((source) => source.kind === 'buffer')).toBe(true);
  });
});

describe('debug/bgm_control（B / M の状態）', () => {
  function setup(): { control: ReturnType<typeof createBgmControl>; changes: BgmStatus[] } {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.SFC);
    const changes: BgmStatus[] = [];
    const control = createBgmControl({ audio: () => director, onChange: (status) => changes.push(status) });
    return { control, changes };
  }

  it('B を押すたびに次の曲へ巡回する', () => {
    const { control, changes } = setup();
    expect(control.status.songId).toBe(DEFAULT_SONG_ID);
    for (let i = 0; i < SONGS.length; i++) control.nextSong();
    expect(control.status.songId).toBe(DEFAULT_SONG_ID); // 1 周して戻る
    expect(changes).toHaveLength(SONGS.length);
    expect(changes.map((status) => status.title)).toContain(songOf('calm').title);
  });

  it('M で消音が反転し、曲名は覚えたままになる', () => {
    const { control } = setup();
    control.nextSong();
    const title = control.status.title;
    control.toggleMute();
    expect(control.status).toEqual({ songId: control.status.songId, title, muted: true });
    control.toggleMute();
    expect(control.status.muted).toBe(false);
    expect(control.status.title).toBe(title);
  });

  it('音がまだ無くても選曲を覚え、現れたときに反映する（自動再生制限の順序）', () => {
    const fake = createFakeAudio();
    let director: ReturnType<typeof createAudioDirector> | null = null;
    const control = createBgmControl({ audio: () => director });
    control.nextSong(); // 音より先に押される
    control.toggleMute();

    director = createAudioDirector(fake.context);
    director.start(PROFILES.SFC);
    control.sync();

    expect(director.currentSong).toBe(songOf(control.status.songId).score);
    expect(director.muted).toBe(true);
  });

  it('画面に出す文面は消音かどうかで変わる', () => {
    expect(bgmStatusText({ songId: 'pop', title: 'ポップ', muted: false })).toBe('BGM ポップ');
    expect(bgmStatusText({ songId: 'pop', title: 'ポップ', muted: true })).toContain('消音');
  });
});

describe('audio/sfx（効果音一式）', () => {
  const IDS = Object.keys(SFX) as SfxId[];

  it('10 種すべてが 4 世代で鳴る（進行に必要な音はどの世代でも欠けない）', () => {
    for (const id of IDS) {
      for (const generation of GENERATION_IDS) {
        expect(sfxRequests(id, PROFILES[generation], 0).length).toBeGreaterThan(0);
      }
    }
  });

  it('声が多い世代ほど層が厚い（§9.3 の「音が埋もれる」）', () => {
    expect(sfxLayers(PROFILES.FC)).toBe(1);
    expect(sfxLayers(PROFILES.SFC)).toBe(1);
    expect(sfxLayers(PROFILES.PS1)).toBe(2);
    expect(sfxLayers(PROFILES.PS2)).toBe(MAX_SFX_LAYERS);
  });

  it('サンプルを持たない世代では掃引が粗い階段になる', () => {
    expect(sweepSteps(PROFILES.FC)).toBe(3);
    expect(sweepSteps(PROFILES.SFC)).toBe(6);
    const fc = sfxRequests('jump', PROFILES.FC, 0);
    expect(fc).toHaveLength(3);
    expect(fc[0]!.frequency).toBeLessThan(fc[2]!.frequency); // jump は上昇
  });

  it('定位を持つ世代にだけ pan が乗る', () => {
    expect(sfxRequests('solve', PROFILES.PS2, 0, { pan: -0.5 })[0]!.pan).toBe(-0.5);
    expect(sfxRequests('solve', PROFILES.FC, 0, { pan: -0.5 })[0]!.pan).toBeUndefined();
  });

  it('意味の方向が音程の向きに一致する（上昇 = 前進 / 下降 = 差し戻し）', () => {
    for (const id of ['jump', 'switch', 'solve', 'checkpoint', 'hint'] as SfxId[]) {
      expect(SFX[id].toPitch).toBeGreaterThan(SFX[id].fromPitch);
    }
    for (const id of ['land', 'respawn', 'deny', 'warning', 'attack'] as SfxId[]) {
      expect(SFX[id].toPitch).toBeLessThan(SFX[id].fromPitch);
    }
  });

  it('効果音は BGM より先に切られる（優先度 0 で確保される）', () => {
    const fake = createFakeAudio();
    const director = createAudioDirector(fake.context);
    director.start(PROFILES.FC);
    director.update();
    // 5 声しかない世代で効果音を浴びせても例外にならず、古い音から切られる
    for (let i = 0; i < 10; i++) director.playSfx('jump', PROFILES.FC);
    expect(director.engine.clock.playing).toBe(true);
  });
});

describe('gameplay/audio_cues（いつ鳴らすか）', () => {
  const level = loadLevelFile('area1');

  it('ジャンプと着地は接地の変化から出る', () => {
    const session = createTestSession({ level, generation: 'PS1' });
    const tracker = createCueTracker();
    tickSession(session, null);
    session.player.grounded = true;
    pollCues(tracker, session); // 接地している状態を取り込む

    session.player.grounded = false;
    session.player.velocity[1] = 5;
    expect(pollCues(tracker, session)).toContain('jump');

    session.player.grounded = true;
    session.player.velocity[1] = 0;
    expect(pollCues(tracker, session)).toContain('land');
  });

  it('起動直後の 1 ティックでは切替音を鳴らさない', () => {
    const session = createTestSession({ level, generation: 'PS1' });
    const tracker = createCueTracker();
    tickSession(session, null);
    expect(pollCues(tracker, session)).not.toContain('switch');

    session.generation.request('FC');
    expect(pollCues(tracker, session)).toContain('switch');
  });

  it('パズルが解けたこと・ヒントが出たことが音になる', () => {
    const session = createTestSession({ level, generation: 'FC' });
    const tracker = createCueTracker();
    tickSession(session, null);
    pollCues(tracker, session);

    // F-1 の位置へ置いて解かせる（第1世代で色が潰れる）
    const pedestal = level.entities.find((entity) => entity.id === 'f1_pedestal')!;
    session.player.position = [...pedestal.transform.position] as [number, number, number];
    tickSession(session, null);
    expect(pollCues(tracker, session)).toContain('solve');

    // 第1世代では解けないパズル（P1-1）の前に立ち、ヒントを引き出す
    const wall = level.entities.find((entity) => entity.id === 'p1_1_wall')!;
    session.player.position = [...wall.transform.position] as [number, number, number];
    tickSession(session, null);
    pollCues(tracker, session);
    expect(session.requestHint()?.puzzleId).toBe('P1-1');
    expect(pollCues(tracker, session)).toContain('hint');
  });

  it('定位はプレイヤーからの左右差で決まる', () => {
    const session = createTestSession({ level, generation: 'PS2' });
    tickSession(session, null);
    const x = session.player.position[0];
    expect(panOf(session, x + 100)).toBe(1);
    expect(panOf(session, x - 100)).toBe(-1);
    expect(panOf(session, x)).toBe(0);
  });
});

describe('audio の量子化（世代ごとの音質差）', () => {
  it('疑似 BRR は各サンプルを独立に 16 段へ丸める', () => {
    const step = 2 / (BRR_LEVELS - 1);
    for (const value of [-1, -0.31, 0, 0.42, 1]) {
      const quantized = brrQuantize(value);
      expect(Math.abs(quantized - value)).toBeLessThanOrEqual(step / 2 + 1e-9);
      expect(Math.abs(quantized / step - Math.round(quantized / step))).toBeLessThan(1e-9);
    }
  });

  it('ADPCM は差分を丸めるので、急峻な立ち上がりが鈍る', () => {
    // 0 から 1 へ 1 サンプルで跳ぶ信号
    const jump = new Float32Array([0, 1, 1, 1, 1, 1]);
    const decoded = adpcmEncodeDecode(jump);
    expect(decoded[1]!).toBeLessThan(1); // 1 サンプルでは追いつけない（差分の刻みが上限）
    expect(decoded[5]!).toBeGreaterThan(0.9); // 数サンプルでほぼ追いつく
    expect(decoded[5]!).toBeLessThanOrEqual(1);
  });
});
