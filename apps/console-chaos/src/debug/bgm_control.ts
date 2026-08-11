/**
 * BGM の切り替え（選曲と消音）。
 *
 * **DOM を触らない。** 「今どの曲か / 鳴らしているか」を持ち、
 * `AudioDirector` に反映して、変化を `onChange` で知らせるだけにしてある
 *（表示は `notice_hud.ts`、鳴らし方は `audio/director.ts`）。
 * 音は最初のユーザ操作まで作られないので、director は**後から現れる**前提で扱う
 *（`audio()` が null を返す間も選曲は覚えておき、現れた時点で `sync()` が反映する）。
 *
 * IMPLEMENTATION_PLAN §3 のツリーには無いファイル。デバッグ操作（R / C と同じ層）なので
 * `debug/` に置いた。本番の設定画面（T3-06）を作るときは、状態の持ち方をここから移す。
 */
import type { AudioDirector } from '@/audio/director';
import { nextSongId, songOf, DEFAULT_SONG_ID, type SongId } from '@/audio/songs';

export interface BgmStatus {
  songId: SongId;
  title: string;
  muted: boolean;
}

/** 画面に出す 1 行。DOM を持たないので、ヘッドレスでも文面を固定できる */
export function bgmStatusText(status: BgmStatus): string {
  return status.muted ? `BGM 消音 — ${status.title}` : `BGM ${status.title}`;
}

export interface BgmControl {
  readonly status: BgmStatus;
  /** 次の曲へ巡回する */
  nextSong(): void;
  /** 消音を切り替える。効果音は止まらない */
  toggleMute(): void;
  /**
   * 今の選曲・消音を director へ反映する。
   * 音が最初のユーザ操作で作られるため、director が現れた直後に 1 度呼ぶ。
   */
  sync(): void;
}

export interface BgmControlOptions {
  /** まだ音が無い間は null を返してよい */
  audio: () => AudioDirector | null;
  /** 選曲・消音が変わったときに呼ばれる（表示の更新用） */
  onChange?: (status: BgmStatus) => void;
  songId?: SongId;
  muted?: boolean;
}

export function createBgmControl(options: BgmControlOptions): BgmControl {
  let songId: SongId = options.songId ?? DEFAULT_SONG_ID;
  let muted = options.muted ?? false;

  function status(): BgmStatus {
    return { songId, title: songOf(songId).title, muted };
  }

  /** 状態を director へ流し込む。director が無ければ覚えておくだけ */
  function apply(notify: boolean): void {
    const audio = options.audio();
    if (audio) {
      audio.changeSong(songOf(songId).score);
      audio.setMuted(muted);
    }
    if (notify) options.onChange?.(status());
  }

  return {
    get status() {
      return status();
    },
    nextSong(): void {
      songId = nextSongId(songId);
      apply(true);
    },
    toggleMute(): void {
      muted = !muted;
      apply(true);
    },
    sync: () => apply(false),
  };
}

/** BGM のデバッグキー。`B` で次の曲へ、`M` で消音の切替 */
export function bindBgmKeys(control: BgmControl, target: Window = window): () => void {
  const down = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    if (key === 'b') control.nextSong();
    else if (key === 'm') control.toggleMute();
  };
  target.addEventListener('keydown', down);
  return () => target.removeEventListener('keydown', down);
}
