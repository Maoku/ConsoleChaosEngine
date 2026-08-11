import { GENERATION_IDS, HARDWARE_GENERATION_PROFILES, type GenerationId, type HardwareGenerationProfile } from './profiles';

export const NORMAL_SWITCH_DURATION_MS = 350;
export const FORCED_SWITCH_DURATION_MS = 600;

export interface GenerationSwitchEvent {
  from: GenerationId;
  to: GenerationId;
  forced: boolean;
  durationMs: number;
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
  request(generation: GenerationId): boolean;
  force(generation: GenerationId): boolean;
  cycle(direction: -1 | 1): boolean;
  advance(dtMs: number): void;
  onSwitch(listener: (event: GenerationSwitchEvent) => void): () => void;
  renderGenerations(): readonly GenerationId[];
}

export function createGenerationController(initial: GenerationId = 'PS1'): GenerationController {
  let generation = initial;
  let queued: { generation: GenerationId; forced: boolean } | null = null;
  const listeners = new Set<(event: GenerationSwitchEvent) => void>();
  const transition: GenerationTransition = {
    active: false,
    from: initial,
    to: initial,
    elapsedMs: 0,
    durationMs: NORMAL_SWITCH_DURATION_MS,
    blend: 1,
    forced: false,
  };

  const begin = (target: GenerationId, forced: boolean): boolean => {
    if (target === generation && !transition.active) return false;
    if (transition.active) {
      queued = { generation: target, forced };
      return true;
    }
    transition.active = true;
    transition.from = generation;
    transition.to = target;
    transition.elapsedMs = 0;
    transition.durationMs = forced ? FORCED_SWITCH_DURATION_MS : NORMAL_SWITCH_DURATION_MS;
    transition.blend = 0;
    transition.forced = forced;
    generation = target;
    const event: GenerationSwitchEvent = { from: transition.from, to: target, forced, durationMs: transition.durationMs };
    for (const listener of [...listeners]) listener(event);
    return true;
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
    request: (target) => begin(target, false),
    force: (target) => begin(target, true),
    cycle(direction): boolean {
      const currentIndex = GENERATION_IDS.indexOf(generation);
      const nextIndex = (currentIndex + direction + GENERATION_IDS.length) % GENERATION_IDS.length;
      return begin(GENERATION_IDS[nextIndex] ?? generation, false);
    },
    advance(dtMs): void {
      if (!transition.active) return;
      transition.elapsedMs = Math.min(transition.elapsedMs + Math.max(dtMs, 0), transition.durationMs);
      transition.blend = transition.elapsedMs / transition.durationMs;
      if (transition.elapsedMs < transition.durationMs) return;
      transition.active = false;
      transition.from = generation;
      transition.to = generation;
      transition.blend = 1;
      if (queued) {
        const next = queued;
        queued = null;
        begin(next.generation, next.forced);
      }
    },
    onSwitch(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    renderGenerations: () => (transition.active ? [transition.from, transition.to] : [generation]),
  };
}
