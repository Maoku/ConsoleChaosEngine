function uint32(value: number): number {
  return value >>> 0;
}

export function mix32(value: number): number {
  let mixed = uint32(value);
  mixed = uint32(mixed ^ 61) ^ (mixed >>> 16);
  mixed = uint32(mixed + (mixed << 3));
  mixed ^= mixed >>> 4;
  mixed = uint32(Math.imul(mixed, 0x27d4eb2d));
  return uint32(mixed ^ (mixed >>> 15));
}

export function hash32(...parts: readonly number[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) hash = mix32(hash ^ uint32(Math.trunc(part)));
  return hash;
}

export function pick(bound: number, ...parts: readonly number[]): number {
  return bound <= 1 ? 0 : hash32(...parts) % Math.trunc(bound);
}

export interface DeterministicRng {
  next(): number;
  int(bound: number): number;
  range(minimum: number, maximum: number): number;
}

export function createRng(seed: number): DeterministicRng {
  let state = uint32(seed);
  const next = (): number => {
    state = uint32(state + 0x6d2b79f5);
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return uint32(value ^ (value >>> 14)) / 4294967296;
  };
  return {
    next,
    int: (bound) => (bound <= 1 ? 0 : Math.floor(next() * bound)),
    range: (minimum, maximum) => minimum + next() * (maximum - minimum),
  };
}
