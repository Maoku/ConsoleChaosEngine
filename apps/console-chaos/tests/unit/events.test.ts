import { describe, it, expect } from 'vitest';
import { createEventBus } from '@/core/events';

interface TestEvents {
  ping: { value: number };
  pong: { value: number };
  [key: string]: unknown;
}

describe('core/events（型付きイベントバス）', () => {
  it('登録順に配信する', () => {
    const bus = createEventBus<TestEvents>();
    const order: string[] = [];
    bus.on('ping', () => order.push('a'));
    bus.on('ping', () => order.push('b'));
    bus.on('ping', () => order.push('c'));
    bus.emit('ping', { value: 1 });
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('購読者が居なくても emit は安全', () => {
    const bus = createEventBus<TestEvents>();
    expect(() => bus.emit('ping', { value: 1 })).not.toThrow();
  });

  it('on の戻り値で解除できる。二重解除も安全', () => {
    const bus = createEventBus<TestEvents>();
    let count = 0;
    const off = bus.on('ping', () => count++);
    bus.emit('ping', { value: 1 });
    off();
    off();
    bus.emit('ping', { value: 1 });
    expect(count).toBe(1);
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('once は 1 度だけ受け取る', () => {
    const bus = createEventBus<TestEvents>();
    const seen: number[] = [];
    bus.once('ping', (p) => seen.push(p.value));
    bus.emit('ping', { value: 1 });
    bus.emit('ping', { value: 2 });
    expect(seen).toEqual([1]);
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('配信中に登録・解除しても、その回の配信対象は変わらない（決定性・不変条件 I4）', () => {
    const bus = createEventBus<TestEvents>();
    const seen: string[] = [];
    const late = (): void => {
      seen.push('late');
    };
    const second = (): void => {
      seen.push('second');
    };
    bus.on('ping', () => {
      seen.push('first');
      bus.on('ping', late); // この回では呼ばれない
      bus.off('ping', second); // この回では呼ばれる
    });
    bus.on('ping', second);
    bus.emit('ping', { value: 1 });
    expect(seen).toEqual(['first', 'second']);

    seen.length = 0;
    bus.emit('ping', { value: 2 });
    expect(seen).toEqual(['first', 'late']);
  });

  it('ハンドラの中から別のイベントを発行できる（再入）', () => {
    const bus = createEventBus<TestEvents>();
    const seen: string[] = [];
    bus.on('ping', () => {
      bus.emit('pong', { value: 9 });
      seen.push('ping-end');
    });
    bus.on('pong', () => seen.push('pong'));
    bus.emit('ping', { value: 1 });
    expect(seen).toEqual(['pong', 'ping-end']);
  });

  it('clear は型指定と全解除の両方ができる', () => {
    const bus = createEventBus<TestEvents>();
    bus.on('ping', () => {});
    bus.on('pong', () => {});
    bus.clear('ping');
    expect(bus.listenerCount('ping')).toBe(0);
    expect(bus.listenerCount('pong')).toBe(1);
    bus.clear();
    expect(bus.listenerCount('pong')).toBe(0);
  });
});
