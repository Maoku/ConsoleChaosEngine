export const FIXED_HZ = 60;
export const FIXED_DT_SECONDS = 1 / FIXED_HZ;
export const FIXED_DT_MS = 1000 / FIXED_HZ;
export const TICK_HZ = FIXED_HZ;
export const TICK_SECONDS = FIXED_DT_SECONDS;
export const TICK_MS = FIXED_DT_MS;
export const MAX_CATCHUP_TICKS = 5;

export interface EngineTime {
  tick: number;
  alpha: number;
  frameMs: number;
  droppedTicks: number;
}

export type Time = EngineTime;

export function createTime(): Time {
  return { tick: 0, alpha: 0, frameMs: 0, droppedTicks: 0 };
}

export function tickToSeconds(tick: number): number {
  return tick * TICK_SECONDS;
}

export interface LoopCallbacks {
  fixedUpdate(tick: number): void;
  render(alpha: number, frameMs: number): void;
}

export interface LoopHost {
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  isHidden(): boolean;
}

export interface FixedStepLoop {
  readonly time: EngineTime;
  start(): void;
  stop(): void;
  frame(nowMs: number): number;
}

export function createFixedStepLoop(callbacks: LoopCallbacks, host: LoopHost): FixedStepLoop {
  const time = createTime();
  let originMs = 0;
  let lastMs = 0;
  let needsReset = true;
  let running = false;
  let handle = 0;

  const frame = (nowMs: number): number => {
    const frameMs = needsReset ? 0 : Math.max(nowMs - lastMs, 0);
    lastMs = nowMs;
    time.frameMs = frameMs;

    if (host.isHidden()) {
      needsReset = true;
      time.alpha = 0;
      time.frameMs = 0;
      return 0;
    }

    if (needsReset) {
      needsReset = false;
      originMs = nowMs - time.tick * FIXED_DT_MS;
      callbacks.render(0, frameMs);
      return 0;
    }

    let pending = Math.floor((nowMs - originMs) / FIXED_DT_MS) - time.tick;
    if (pending > MAX_CATCHUP_TICKS) {
      const dropped = pending - MAX_CATCHUP_TICKS;
      time.droppedTicks += dropped;
      originMs += dropped * FIXED_DT_MS;
      pending = MAX_CATCHUP_TICKS;
    }

    for (let index = 0; index < pending; index++) {
      callbacks.fixedUpdate(time.tick);
      time.tick++;
    }

    const remainder = (nowMs - originMs) / FIXED_DT_MS - time.tick;
    time.alpha = Math.min(Math.max(remainder, 0), 0.999_999_999);
    callbacks.render(time.alpha, frameMs);
    return Math.max(pending, 0);
  };

  const schedule = (): void => {
    handle = host.requestFrame(() => {
      if (!running) return;
      frame(host.now());
      schedule();
    });
  };

  return {
    time,
    start(): void {
      if (running) return;
      running = true;
      needsReset = true;
      schedule();
    },
    stop(): void {
      if (!running) return;
      running = false;
      host.cancelFrame(handle);
    },
    frame,
  };
}

export interface LegacyLoopCallbacks {
  tick(tick: number): void;
  render(alpha: number, frameMs: number): void;
}

export type Loop = FixedStepLoop;

export function createLoop(callbacks: LegacyLoopCallbacks, host: LoopHost): Loop {
  return createFixedStepLoop({ fixedUpdate: callbacks.tick, render: callbacks.render }, host);
}

export function browserHost(): LoopHost {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => requestAnimationFrame(() => callback()),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    isHidden: () => document.hidden,
  };
}
