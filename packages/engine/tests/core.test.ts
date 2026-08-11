import { describe, expect, it } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createRng, hash32 } from '../src/core/rng';
import { createFixedStepLoop, FIXED_DT_MS } from '../src/core/time';
import { createTransportClock } from '../src/audio/service';

describe('engine core', () => {
  it('keeps event order deterministic while listeners mutate subscriptions', () => {
    const bus = createEventBus<{ ping: number }>();
    const values: number[] = [];
    let removeSecond = () => {};
    bus.on('ping', (value) => {
      values.push(value);
      removeSecond();
    });
    removeSecond = bus.on('ping', (value) => values.push(value * 10));
    bus.emit('ping', 2);
    bus.emit('ping', 3);
    expect(values).toEqual([2, 20, 3]);
  });

  it('repeats random streams from the same seed', () => {
    const first = createRng(42);
    const second = createRng(42);
    expect([first.next(), first.next(), first.int(7)]).toEqual([second.next(), second.next(), second.int(7)]);
    expect(hash32(1, 2)).not.toBe(hash32(2, 1));
  });

  it('caps catch-up and does not catch up hidden time', () => {
    let hidden = false;
    const ticks: number[] = [];
    const loop = createFixedStepLoop({ fixedUpdate: (tick) => ticks.push(tick), render: () => {} }, {
      now: () => 0,
      requestFrame: () => 1,
      cancelFrame: () => {},
      isHidden: () => hidden,
    });
    loop.frame(0);
    expect(loop.frame(FIXED_DT_MS * 20)).toBe(5);
    expect(loop.time.droppedTicks).toBe(15);
    hidden = true;
    loop.frame(FIXED_DT_MS * 100);
    hidden = false;
    expect(loop.frame(FIXED_DT_MS * 101)).toBe(0);
    expect(ticks).toHaveLength(5);
  });

  it('keeps music bar phase independent from generation switches', () => {
    const clock = createTransportClock(120, 4);
    clock.start(0);
    const before = clock.barAt(3.7);
    const simulatedGenerationChanges = ['FC', 'SFC', 'PS1', 'PS2', 'FC'];
    for (const _generation of simulatedGenerationChanges) expect(clock.barAt(3.7)).toBe(before);
  });
});
