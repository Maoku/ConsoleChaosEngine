import type { GenerationId } from '@console-chaos/engine';
import type { RaceEvent, RaceState } from '../gameplay/race';
import { RACE_LAPS } from '../gameplay/race';
import { racingTheme } from '../config/themes';

export interface RacingHudModel {
  generationLabel: string;
  lapText: string;
  rankText: string;
  timeText: string;
  countdownText: string;
  resultText: string;
  restartVisible: boolean;
}

export function formatRaceTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`;
}

export function hudModelFromRace(state: RaceState, generation: GenerationId): RacingHudModel {
  const elapsed = state.phase === 'finished'
    ? (state.resultTime ?? 0)
    : Math.max(0, state.tick - 180) / 60;
  return {
    generationLabel: racingTheme(generation).label,
    lapText: `LAP ${Math.min(state.player.laps.lap + 1, RACE_LAPS)}/${RACE_LAPS}`,
    rankText: `P${state.rank}/2`,
    timeText: formatRaceTime(elapsed),
    countdownText: state.phase === 'countdown' ? String(Math.max(1, Math.ceil(state.countdownTicks / 60))) : '',
    resultText: state.phase === 'finished' ? `FINISH  P${state.rank}  ${formatRaceTime(state.resultTime ?? 0)}` : '',
    restartVisible: state.phase === 'finished',
  };
}

function announcementFor(events: readonly RaceEvent[], state: RaceState): string | null {
  if (events.includes('finish')) return `フィニッシュ、順位 ${state.rank}`;
  if (events.includes('lap')) return `ラップ ${Math.min(state.player.laps.lap + 1, RACE_LAPS)}`;
  if (events.includes('start')) return 'レーススタート';
  return null;
}

export interface RacingHud {
  update(model: RacingHudModel, events?: readonly RaceEvent[], state?: RaceState): void;
  dispose(): void;
}

export function createRacingHud(root: HTMLElement): RacingHud {
  const slot = (name: string): HTMLElement => {
    const element = root.querySelector<HTMLElement>(`[data-hud="${name}"]`);
    if (!element) throw new Error(`Missing Racing HUD slot: ${name}`);
    return element;
  };
  const generation = slot('generation');
  const lap = slot('lap');
  const rank = slot('rank');
  const time = slot('time');
  const countdown = slot('countdown');
  const result = slot('result');
  const restart = slot('restart');
  const announcer = slot('announcer');

  return {
    update(model, events = [], state): void {
      generation.textContent = model.generationLabel;
      lap.textContent = model.lapText;
      rank.textContent = model.rankText;
      time.textContent = model.timeText;
      countdown.textContent = model.countdownText;
      countdown.hidden = model.countdownText.length === 0;
      result.textContent = model.resultText;
      result.hidden = model.resultText.length === 0;
      restart.hidden = !model.restartVisible;
      const announcement = state ? announcementFor(events, state) : null;
      if (announcement) announcer.textContent = announcement;
    },
    dispose(): void {
      for (const element of [generation, lap, rank, time, countdown, result, restart, announcer]) {
        element.textContent = '';
      }
    },
  };
}
