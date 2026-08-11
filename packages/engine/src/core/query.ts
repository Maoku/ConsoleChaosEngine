import type { ComponentDef } from './component';
import type { Entity, World } from './world';

export function query1<A>(world: World, a: ComponentDef<A>, callback: (entity: Entity, value: A) => void): void {
  const store = world.store(a);
  for (const entity of [...store.entities()].sort((left, right) => left - right)) {
    const value = store.get(entity);
    if (value !== undefined) callback(entity, value);
  }
}

export function query2<A, B>(
  world: World,
  a: ComponentDef<A>,
  b: ComponentDef<B>,
  callback: (entity: Entity, valueA: A, valueB: B) => void,
): void {
  const storeA = world.store(a);
  const storeB = world.store(b);
  const primary = storeA.size <= storeB.size ? storeA : storeB;
  for (const entity of [...primary.entities()].sort((left, right) => left - right)) {
    const valueA = storeA.get(entity);
    const valueB = storeB.get(entity);
    if (valueA !== undefined && valueB !== undefined) callback(entity, valueA, valueB);
  }
}

export function query3<A, B, C>(
  world: World,
  a: ComponentDef<A>,
  b: ComponentDef<B>,
  c: ComponentDef<C>,
  callback: (entity: Entity, valueA: A, valueB: B, valueC: C) => void,
): void {
  query2(world, a, b, (entity, valueA, valueB) => {
    const valueC = world.get(entity, c);
    if (valueC !== undefined) callback(entity, valueA, valueB, valueC);
  });
}

export function collect<A>(world: World, definition: ComponentDef<A>, predicate?: (value: A) => boolean): Entity[] {
  const entities: Entity[] = [];
  query1(world, definition, (entity, value) => {
    if (!predicate || predicate(value)) entities.push(entity);
  });
  return entities;
}

