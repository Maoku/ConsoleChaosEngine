import type { ConsoleAudioPresenter } from '@/audio/presenter';
import { DEFAULT_SONG_ID, nextSongId, songOf, type SongId } from '@/audio/songs';

export interface BgmStatus {
  songId: SongId;
  title: string;
  muted: boolean;
}

export function bgmStatusText(status: BgmStatus): string {
  return status.muted ? `BGM 消音 — ${status.title}` : `BGM ${status.title}`;
}

export interface BgmControl {
  readonly status: BgmStatus;
  nextSong(): void;
  toggleMute(): void;
  sync(): void;
}

export interface BgmControlOptions {
  audio: () => ConsoleAudioPresenter | null;
  onChange?: (status: BgmStatus) => void;
  songId?: SongId;
  muted?: boolean;
}

export function createBgmControl(options: BgmControlOptions): BgmControl {
  let songId = options.songId ?? DEFAULT_SONG_ID;
  let muted = options.muted ?? false;
  const status = (): BgmStatus => ({ songId, title: songOf(songId).title, muted });
  const apply = (notify: boolean): void => {
    const audio = options.audio();
    if (audio) {
      audio.changeSong(songOf(songId).score);
      audio.setMuted(muted);
    }
    if (notify) options.onChange?.(status());
  };

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
