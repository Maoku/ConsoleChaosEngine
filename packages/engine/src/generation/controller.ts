import { GENERATION_IDS, HARDWARE_GENERATION_PROFILES, type GenerationId, type HardwareGenerationProfile } from './profiles';

export const NORMAL_SWITCH_DURATION_MS = 350;
export const FORCED_SWITCH_DURATION_MS = 600;
export const FORCED_WARNING_MS = 1500;

export type GenerationSwitchReason = 'player' | 'forced';

export interface GenerationSwitchEvent {
  from: GenerationId;
  to: GenerationId;
  reason: GenerationSwitchReason;
  forced: boolean;
  durationMs: number;
  fromProfile: HardwareGenerationProfile;
  toProfile: HardwareGenerationProfile;
}

export interface GenerationForcedWarningEvent {
  to: GenerationId;
  toProfile: HardwareGenerationProfile;
  leadMs: number;
}

export interface GenerationTransition {
  active: boolean;
  from: GenerationId;
  to: GenerationId;
  elapsedMs: number;
  durationMs: number;
  blend: number;
  forced: boolean;
}

export interface GenerationController {
  readonly generation: GenerationId;
  readonly profile: HardwareGenerationProfile;
  readonly transition: Readonly<GenerationTransition>;
  readonly invulnerable: boolean;
  readonly pending: GenerationId | null;
  readonly forced: boolean;
  readonly warningRemainingMs: number | null;
  readonly warningTo: GenerationId | null;
  request(generation: GenerationId): boolean;
  force(generation: GenerationId): boolean;
  cycle(direction: -1 | 1): boolean;
  scheduleForced(generation: GenerationId, leadMs?: number): void;
  cancelForcedWarning(): void;
  releaseForced(): void;
  advance(dtMs: number): void;
  onBeforeSwitch(listener: (event: GenerationSwitchEvent) => void): () => void;
  onSwitch(listener: (event: GenerationSwitchEvent) => void): () => void;
  onAfterSwitch(listener: (event: GenerationSwitchEvent) => void): () => void;
  onForcedWarning(listener: (event: GenerationForcedWarningEvent) => void): () => void;
  onForcedCancel(listener: (event: { to: GenerationId }) => void): () => void;
  onForcedRelease(listener: (event: { generation: GenerationId }) => void): () => void;
  renderGenerations(): readonly GenerationId[];
}

export function createGenerationController(initial: GenerationId = 'PS1'): GenerationController {
  let generation = initial;
  let queued: { generation: GenerationId; reason: GenerationSwitchReason } | null = null;
  let activeEvent: GenerationSwitchEvent | null = null;
  let forcedActive = false;
  let warning: { generation: GenerationId; remainingMs: number; leadMs: number } | null = null;
  const beforeListeners = new Set<(event: GenerationSwitchEvent) => void>();
  const switchListeners = new Set<(event: GenerationSwitchEvent) => void>();
  const afterListeners = new Set<(event: GenerationSwitchEvent) => void>();
  const warningListeners = new Set<(event: GenerationForcedWarningEvent) => void>();
  const cancelListeners = new Set<(event: { to: GenerationId }) => void>();
  const releaseListeners = new Set<(event: { generation: GenerationId }) => void>();
  const transition: GenerationTransition = {
    active: false,
    from: initial,
    to: initial,
    elapsedMs: 0,
    durationMs: NORMAL_SWITCH_DURATION_MS,
    blend: 1,
    forced: false,
  };

  const notify = <Event>(listeners: Set<(event: Event) => void>, event: Event): void => {
    for (const listener of [...listeners]) listener(event);
  };

  const begin = (target: GenerationId, reason: GenerationSwitchReason): boolean => {
    if (target === generation && !transition.active) return false;
    if (transition.active) {
      if (queued?.reason === 'forced' && reason === 'player') return false;
      queued = { generation: target, reason };
      return true;
    }
    const forced = reason === 'forced';
    const event: GenerationSwitchEvent = {
      from: generation,
      to: target,
      reason,
      forced,
      durationMs: forced ? FORCED_SWITCH_DURATION_MS : NORMAL_SWITCH_DURATION_MS,
      fromProfile: HARDWARE_GENERATION_PROFILES[generation],
      toProfile: HARDWARE_GENERATION_PROFILES[target],
    };
    notify(beforeListeners, event);
    transition.active = true;
    transition.from = generation;
    transition.to = target;
    transition.elapsedMs = 0;
    transition.durationMs = event.durationMs;
    transition.blend = 0;
    transition.forced = forced;
    generation = target;
    activeEvent = event;
    if (forced) forcedActive = true;
    notify(switchListeners, event);
    return true;
  };

  const listen = <Event>(listeners: Set<(event: Event) => void>, listener: (event: Event) => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    get generation() {
      return generation;
    },
    get profile() {
      return HARDWARE_GENERATION_PROFILES[generation];
    },
    transition,
    get invulnerable() {
      return transition.active;
    },
    get pending() {
      return queued?.generation ?? null;
    },
    get forced() {
      return forcedActive;
    },
    get warningRemainingMs() {
      return warning?.remainingMs ?? null;
    },
    get warningTo() {
      return warning?.generation ?? null;
    },
    request: (target) => begin(target, 'player'),
    force: (target) => begin(target, 'forced'),
    cycle(direction): boolean {
      const baseGeneration = queued?.generation ?? generation;
      const currentIndex = GENERATION_IDS.indexOf(baseGeneration);
      const nextIndex = (currentIndex + direction + GENERATION_IDS.length) % GENERATION_IDS.length;
      return begin(GENERATION_IDS[nextIndex] ?? generation, 'player');
    },
    scheduleForced(target, leadMs = FORCED_WARNING_MS): void {
      if (leadMs <= 0) {
        begin(target, 'forced');
        return;
      }
      warning = { generation: target, remainingMs: leadMs, leadMs };
      notify(warningListeners, { to: target, toProfile: HARDWARE_GENERATION_PROFILES[target], leadMs });
    },
    cancelForcedWarning(): void {
      if (!warning) return;
      const to = warning.generation;
      warning = null;
      notify(cancelListeners, { to });
    },
    releaseForced(): void {
      if (!forcedActive) return;
      forcedActive = false;
      warning = null;
      notify(releaseListeners, { generation });
    },
    advance(dtMs): void {
      const elapsed = Math.max(dtMs, 0);
      if (transition.active) {
        transition.elapsedMs = Math.min(transition.elapsedMs + elapsed, transition.durationMs);
        transition.blend = transition.elapsedMs / transition.durationMs;
        if (transition.elapsedMs >= transition.durationMs) {
          transition.active = false;
          transition.from = generation;
          transition.to = generation;
          transition.blend = 1;
          if (activeEvent) notify(afterListeners, activeEvent);
          activeEvent = null;
          if (queued) {
            const next = queued;
            queued = null;
            if (next.generation !== generation) begin(next.generation, next.reason);
          }
        }
      }
      if (warning) {
        warning.remainingMs = Math.max(warning.remainingMs - elapsed, 0);
        if (warning.remainingMs === 0) {
          const target = warning.generation;
          warning = null;
          begin(target, 'forced');
        }
      }
    },
    onBeforeSwitch: (listener) => listen(beforeListeners, listener),
    onSwitch: (listener) => listen(switchListeners, listener),
    onAfterSwitch: (listener) => listen(afterListeners, listener),
    onForcedWarning: (listener) => listen(warningListeners, listener),
    onForcedCancel: (listener) => listen(cancelListeners, listener),
    onForcedRelease: (listener) => listen(releaseListeners, listener),
    renderGenerations: () => (transition.active ? [transition.from, transition.to] : [generation]),
  };
}
