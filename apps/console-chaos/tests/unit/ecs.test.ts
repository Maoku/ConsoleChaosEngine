import { describe, it, expect } from 'vitest';
import { createWorld, NO_ENTITY } from '@/core/ecs/world';
import { defineComponent } from '@/core/ecs/component';
import { collect, query1, query2, query3 } from '@/core/ecs/query';
import { STAGES, createSchedule } from '@/core/ecs/system';

interface Transform {
  position: [number, number, number];
}
interface Velocity {
  value: [number, number, number];
}
interface Tag {
  label: string;
}

const Transform = defineComponent<Transform>('Transform', () => ({ position: [0, 0, 0] }));
const Velocity = defineComponent<Velocity>('Velocity', () => ({ value: [0, 0, 0] }));
const Tag = defineComponent<Tag>('Tag');

describe('ECS: World', () => {
  it('エンティティを作って壊せる', () => {
    const world = createWorld();
    const a = world.create();
    const b = world.create();
    expect(world.entityCount).toBe(2);
    expect(world.alive(a)).toBe(true);

    world.destroy(a);
    expect(world.alive(a)).toBe(false);
    expect(world.alive(b)).toBe(true);
    expect(world.entityCount).toBe(1);
    expect(a).not.toBe(NO_ENTITY);
  });

  it('破棄した番号を使い回さない（リプレイの再現性のため）', () => {
    const world = createWorld();
    const a = world.create();
    world.destroy(a);
    const b = world.create();
    expect(b).not.toBe(a);
  });

  it('破棄するとコンポーネントも消える', () => {
    const world = createWorld();
    const entity = world.create();
    world.add(entity, Transform);
    world.destroy(entity);
    expect(world.get(entity, Transform)).toBeUndefined();
    expect(world.store(Transform).size).toBe(0);
  });

  it('既定値を持つコンポーネントは値なしで追加できる', () => {
    const world = createWorld();
    const entity = world.create();
    const transform = world.add(entity, Transform);
    expect(transform.position).toEqual([0, 0, 0]);
  });

  it('既定値を持たないコンポーネントは値を要求する', () => {
    const world = createWorld();
    const entity = world.create();
    expect(() => world.add(entity, Tag)).toThrow(/既定値を持たない/);
    expect(world.add(entity, Tag, { label: 'player' }).label).toBe('player');
  });

  it('コンポーネントの付け替えで表現を変えられる（§4.3 の方針）', () => {
    const world = createWorld();
    const entity = world.create();
    world.add(entity, Velocity);
    expect(world.has(entity, Velocity)).toBe(true);
    world.remove(entity, Velocity);
    expect(world.has(entity, Velocity)).toBe(false);
  });
});

describe('ECS: クエリ', () => {
  it('2 つのコンポーネントを持つエンティティだけを走査する', () => {
    const world = createWorld();
    const both = world.create();
    const onlyTransform = world.create();
    world.add(both, Transform);
    world.add(both, Velocity);
    world.add(onlyTransform, Transform);

    const visited: number[] = [];
    query2(world, Transform, Velocity, (entity) => visited.push(entity));
    expect(visited).toEqual([both]);
  });

  it('走査順はエンティティ番号順で安定する（不変条件 I4）', () => {
    const world = createWorld();
    const entities = [world.create(), world.create(), world.create()];
    for (const entity of entities) world.add(entity, Transform);
    // 逆順に触っても走査順は変わらない
    world.get(entities[2]!, Transform);

    const first: number[] = [];
    query1(world, Transform, (entity) => first.push(entity));
    const second: number[] = [];
    query1(world, Transform, (entity) => second.push(entity));
    expect(first).toEqual(entities);
    expect(second).toEqual(first);
  });

  it('3 つのコンポーネントでも走査できる', () => {
    const world = createWorld();
    const entity = world.create();
    world.add(entity, Transform);
    world.add(entity, Velocity);
    world.add(entity, Tag, { label: 'x' });
    const visited: string[] = [];
    query3(world, Transform, Velocity, Tag, (_e, _t, _v, tag) => visited.push(tag.label));
    expect(visited).toEqual(['x']);
  });

  it('collect は条件に合うエンティティを配列で返す', () => {
    const world = createWorld();
    const a = world.create();
    const b = world.create();
    world.add(a, Tag, { label: 'keep' });
    world.add(b, Tag, { label: 'drop' });
    expect(collect(world, Tag, (tag) => tag.label === 'keep')).toEqual([a]);
  });
});

describe('ECS: システムの実行順（§4.4）', () => {
  it('段階の順序は §4.4 の 1〜8 に対応する', () => {
    expect([...STAGES]).toEqual([
      'input',
      'generation',
      'constraints',
      'gameplay',
      'physics',
      'triggers',
      'audio',
      'present',
    ]);
  });

  it('登録順ではなく段階順に実行される', () => {
    const world = createWorld();
    const schedule = createSchedule();
    const order: string[] = [];
    schedule.add('present', 'draw', () => order.push('draw'));
    schedule.add('input', 'sample', () => order.push('sample'));
    schedule.add('physics', 'integrate', () => order.push('integrate'));
    schedule.run(world, 0);
    expect(order).toEqual(['sample', 'integrate', 'draw']);
  });

  it('同じ段階の中では登録順を保つ', () => {
    const world = createWorld();
    const schedule = createSchedule();
    const order: string[] = [];
    schedule.add('gameplay', 'a', () => order.push('a'));
    schedule.add('gameplay', 'b', () => order.push('b'));
    schedule.run(world, 0);
    expect(order).toEqual(['a', 'b']);
  });

  it('システム名の重複は登録時に弾く', () => {
    const schedule = createSchedule();
    schedule.add('gameplay', 'dup', () => {});
    expect(() => schedule.add('physics', 'dup', () => {})).toThrow(/重複/);
  });

  it('実行順を人が読める形で説明できる', () => {
    const schedule = createSchedule();
    schedule.add('physics', 'integrate', () => {});
    schedule.add('input', 'sample', () => {});
    expect(schedule.describe()).toEqual(['input: sample', 'physics: integrate']);
  });

  it('システムは実時間を受け取らずティック番号だけを受け取る（不変条件 I3）', () => {
    const world = createWorld();
    const schedule = createSchedule();
    const ticks: number[] = [];
    schedule.add('gameplay', 'record', (_w, tick) => ticks.push(tick));
    schedule.run(world, 5);
    schedule.run(world, 6);
    expect(ticks).toEqual([5, 6]);
  });
});
