/**
 * 音の組み立て（T1-16）。
 *
 * 「どの音源で、どの編曲を鳴らすか」を**プロファイルの値から決める唯一の場所**。
 * engine は世代を知らず、各音源は自分の合成方式しか知らない。その 2 つを繋ぐ。
 *
 * IMPLEMENTATION_PLAN §3 のツリーには無いファイル。§5.8 は engine / clock / score /
 * 音源 4 種 / sfx / voicelimit を挙げるが、**それらを世代に応じて束ねる場所**を挙げていない。
 * main.ts（ブートストラップのみ）にも、engine（世代非依存）にも置けないので T1-15 の
 * `gameplay/session.ts` と同じ理由で新設した。
 *
 * 世代 ID では分岐しない。`profile.audio.synth` で音源を、
 * `profile.audio.channels` などで編曲を決める（不変条件 I2）。
 */
import type { GenerationProfile, SynthKind } from '@/generation/profiles';
import { createAudioEngine, type AudioEngine, type GenerationVoiceSource, type VoiceSourceOptions } from './engine';
import { createPs1Source } from './adpcm_ps1';
import { arrangeFor } from './music';
import { createSfcSampler } from './sampler_sfc';
import { createPs2Source } from './stream_ps2';
import { createFcSource } from './synth_fc';
import { sfxRequests, type SfxId, type SfxOptions } from './sfx';
import { scoreLengthTicks, type Score } from './score';
import { DEFAULT_SONG_ID, songOf } from './songs';

type SourceFactory = (
  ctx: BaseAudioContext,
  destination: AudioNode,
  options: VoiceSourceOptions,
) => GenerationVoiceSource;

/** 合成方式 → 音源。世代が増えても、増えるのはこの表の行だけ */
const SOURCE_FACTORIES: Record<SynthKind, SourceFactory> = {
  psg: createFcSource,
  brr: createSfcSampler,
  adpcm: createPs1Source,
  streaming: createPs2Source,
};

/**
 * 効果音を予約する余裕（秒）。0 だと「今すぐ」になり、
 * ブラウザによっては先頭が欠ける。
 */
export const SFX_LEAD_SECONDS = 0.01;

export interface AudioDirector {
  readonly engine: AudioEngine;
  /** 今どの合成方式で鳴らしているか（= 使用中の音源のキー） */
  readonly currentSynth: SynthKind | null;
  /** 今どの曲を鳴らしているか（選曲。世代とは無関係） */
  readonly currentSong: Score;
  /** BGM が止められているか。止まっていても効果音は鳴る */
  readonly muted: boolean;
  /** BGM を鳴らし始める。ユーザ操作のあとに呼ぶこと（ブラウザの自動再生制限） */
  start(profile: GenerationProfile, fromTick?: number): void;
  /** 世代が変わったときに呼ぶ。音源と編曲が変わり、小節位置は保たれる */
  applyProfile(profile: GenerationProfile): void;
  /**
   * 曲を差し替える（選曲）。**世代切替と違い、位相は保たれない。**
   * テンポが違えば「同じ小節位置」の意味が変わるため、曲頭から鳴らし直す。
   */
  changeSong(song: Score): void;
  /**
   * BGM を止める / 戻す。効果音はそのまま鳴る（音量ではなく**予約を止める**）。
   * 戻すときは止めた位置から続ける。
   */
  setMuted(value: boolean): void;
  playSfx(id: SfxId, profile: GenerationProfile, options?: SfxOptions): void;
  /** 先読みスケジューリング。毎フレーム呼ぶ */
  update(): void;
  /** 0..1。設定画面の音量（T3-06）から書き換える */
  setVolume(value: number): void;
  dispose(): void;
}

export interface AudioDirectorOptions {
  /** 起動時の曲。省略すると目録の既定（`songs.ts`） */
  song?: Score;
  destination?: AudioNode;
  volume?: number;
  /** 起動時から BGM を止めておく */
  muted?: boolean;
}

export function createAudioDirector(
  ctx: BaseAudioContext,
  options: AudioDirectorOptions = {},
): AudioDirector {
  let song = options.song ?? songOf(DEFAULT_SONG_ID).score;
  let muted = options.muted ?? false;
  /** 止めたときの位置。戻したときにここから続ける */
  let pausedAtTick = 0;
  const master = ctx.createGain();
  master.gain.value = options.volume ?? 0.8;
  master.connect(options.destination ?? ctx.destination);

  const engine = createAudioEngine(ctx, song);
  const registered = new Set<SynthKind>();
  let currentSynth: SynthKind | null = null;
  /** 適用中のプロファイル。毎フレーム呼ばれても、変わっていなければ何もしない */
  let currentProfile: GenerationProfile | null = null;
  /** 編曲は世代ごとに 1 度だけ組み立てる（毎フレームの割り当てを避ける。§6.1） */
  const arrangements = new Map<SynthKind, Score>();

  function arrangement(profile: GenerationProfile): Score {
    let score = arrangements.get(profile.audio.synth);
    if (!score) {
      score = arrangeFor(profile, song);
      arrangements.set(profile.audio.synth, score);
    }
    return score;
  }

  /** 今の再生位置（ティック）。止まっているときは最後に止めた位置 */
  function positionTick(): number {
    return engine.clock.playing ? engine.clock.tickAt(ctx.currentTime) : pausedAtTick;
  }

  /** 止まっていない限り、指定位置から鳴らし直す */
  function playFrom(profile: GenerationProfile, fromTick: number): void {
    const score = arrangement(profile);
    pausedAtTick = fromTick % Math.max(scoreLengthTicks(score), 1);
    if (muted) {
      engine.stopMusic();
      return;
    }
    engine.startMusic(score, pausedAtTick);
  }

  /** 音源は使う直前に作る（鳴らさない世代のノードを抱えない） */
  function ensureSource(profile: GenerationProfile): SynthKind {
    const synth = profile.audio.synth;
    if (!registered.has(synth)) {
      engine.registerSource(
        synth,
        SOURCE_FACTORIES[synth](ctx, master, {
          voiceLimit: profile.audio.channels,
          sampleRate: profile.audio.sampleRate,
          reverb: profile.audio.reverb,
          positional: profile.audio.positional,
        }),
      );
      registered.add(synth);
    }
    return synth;
  }

  function applyProfile(profile: GenerationProfile): void {
    if (profile === currentProfile) return;
    currentProfile = profile;
    const synth = ensureSource(profile);
    if (synth !== currentSynth) {
      engine.useSource(synth);
      currentSynth = synth;
    }
    engine.useArrangement(arrangement(profile));
  }

  return {
    engine,
    get currentSynth() {
      return currentSynth;
    },
    get currentSong() {
      return song;
    },
    get muted() {
      return muted;
    },
    start(profile, fromTick = 0): void {
      applyProfile(profile);
      playFrom(profile, fromTick);
    },
    applyProfile,
    changeSong(next): void {
      if (next === song) return;
      song = next;
      // 編曲は曲ごとに組み立て直す（同時発音数の判断は同じでも、素材が違う）
      arrangements.clear();
      engine.stopMusic();
      // まだ鳴らしていなければ、次の start() から新しい曲になる
      if (currentProfile) playFrom(currentProfile, 0);
    },
    setMuted(value): void {
      if (value === muted) return;
      // 止める前に位置を控える。戻したときはここから続く
      pausedAtTick = positionTick();
      muted = value;
      if (!currentProfile) return;
      if (value) engine.stopMusic();
      else engine.startMusic(arrangement(currentProfile), pausedAtTick);
    },
    playSfx(id, profile, sfxOptions): void {
      const when = ctx.currentTime + SFX_LEAD_SECONDS;
      for (const request of sfxRequests(id, profile, when, sfxOptions)) engine.playOneShot(request);
    },
    update: () => engine.update(),
    setVolume(value): void {
      master.gain.value = Math.max(0, Math.min(1, value));
    },
    dispose(): void {
      engine.dispose();
      master.disconnect();
      registered.clear();
      arrangements.clear();
      currentSynth = null;
      currentProfile = null;
    },
  };
}
