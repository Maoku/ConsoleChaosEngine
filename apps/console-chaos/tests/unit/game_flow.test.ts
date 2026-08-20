import { describe, expect, it, vi } from 'vitest';
import {
  TITLE_DEMO_IDLE_MS,
  createGameFlowController,
  type RunMode,
} from '@/ui/game_flow';

function setup() {
  let now = 0;
  let cleared = false;
  const modes: RunMode[] = [];
  const callbacks = {
    manualStart: vi.fn(),
    manualRestart: vi.fn(),
    manualFinish: vi.fn(),
    demoStart: vi.fn(() => true),
    returnTitle: vi.fn(),
  };
  const flow = createGameFlowController({
    now: () => now,
    isCleared: () => cleared,
    onManualStart: callbacks.manualStart,
    onManualRestart: callbacks.manualRestart,
    onManualFinish: callbacks.manualFinish,
    onDemoStart: callbacks.demoStart,
    onReturnTitle: callbacks.returnTitle,
    onModeChange: (mode) => modes.push(mode),
  });
  return {
    flow,
    callbacks,
    modes,
    setNow(value: number) { now = value; },
    clear() { cleared = true; },
  };
}

describe('game flow controller', () => {
  it('starts the demo exactly at 10 seconds of visible title inactivity', () => {
    const { flow, callbacks, setNow } = setup();
    setNow(TITLE_DEMO_IDLE_MS - 1);
    flow.update();
    expect(callbacks.demoStart).not.toHaveBeenCalled();
    setNow(TITLE_DEMO_IDLE_MS);
    flow.update();
    flow.update();
    expect(callbacks.demoStart).toHaveBeenCalledOnce();
    expect(flow.mode).toBe('demo');
  });

  it('resets title idle on activity, gamepad input, and visibility restore', () => {
    const { flow, callbacks, setNow } = setup();
    setNow(9_000);
    flow.activity();
    setNow(18_999);
    flow.update();
    expect(callbacks.demoStart).not.toHaveBeenCalled();
    flow.update(19_000, true);
    flow.setVisible(false, 20_000);
    flow.update(40_000);
    flow.setVisible(true, 40_000);
    flow.update(49_999);
    expect(callbacks.demoStart).not.toHaveBeenCalled();
    flow.update(50_000);
    expect(callbacks.demoStart).toHaveBeenCalledOnce();
  });

  it('moves manual play through clear and restart', () => {
    const { flow, callbacks, clear } = setup();
    flow.startManual();
    expect(flow.mode).toBe('manual');
    clear();
    flow.update();
    expect(callbacks.manualFinish).toHaveBeenCalledWith(true);
    expect(flow.mode).toBe('clear');
    flow.restartManual();
    expect(callbacks.manualRestart).toHaveBeenCalledOnce();
    expect(flow.mode).toBe('manual');
  });

  it('returns an interrupted demo to title and starts a fresh idle window', () => {
    const { flow, callbacks } = setup();
    flow.update(TITLE_DEMO_IDLE_MS);
    flow.activity(12_000);
    expect(callbacks.returnTitle).toHaveBeenCalledOnce();
    expect(flow.mode).toBe('title');
    flow.update(21_999);
    expect(callbacks.demoStart).toHaveBeenCalledOnce();
    flow.update(22_000);
    expect(callbacks.demoStart).toHaveBeenCalledTimes(2);
  });
});
