import type { ComponentDef } from './component';

export type Entity = number;
export type EntityId = Entity;
export const NO_ENTITY: Entity = -1;

export interface ComponentStore<Value> {
  add(entity: Entity, value: Value): Value;
  get(entity: Entity): Value | undefined;
  has(entity: Entity): boolean;
  remove(entity: Entity): void;
  each(callback: (entity: Entity, value: Value) => void): void;
  readonly size: number;
  entities(): IterableIterator<Entity>;
}

export interface World {
  create(): Entity;
  destroy(entity: Entity): void;
  alive(entity: Entity): boolean;
  readonly entityCount: number;
  store<Value>(definition: ComponentDef<Value>): ComponentStore<Value>;
  add<Value>(entity: Entity, definition: ComponentDef<Value>, value?: Value): Value;
  get<Value>(entity: Entity, definition: ComponentDef<Value>): Value | undefined;
  has<Value>(entity: Entity, definition: ComponentDef<Value>): boolean;
  remove<Value>(entity: Entity, definition: ComponentDef<Value>): void;
  entities(): Entity[];
  clear(): void;
}

function createStore<Value>(): ComponentStore<Value> {
  const values = new Map<Entity, Value>();
  return {
    add(entity, value) {
      values.set(entity, value);
      return value;
    },
    get: (entity) => values.get(entity),
    has: (entity) => values.has(entity),
    remove: (entity) => { values.delete(entity); },
    each: (callback) => { for (const [entity, value] of values) callback(entity, value); },
    get size() { return values.size; },
    entities: () => values.keys(),
  };
}

export function createWorld(): World {
  const stores = new Map<number, ComponentStore<unknown>>();
  const living = new Set<Entity>();
  let nextEntity = 1;

  const storeOf = <Value>(definition: ComponentDef<Value>): ComponentStore<Value> => {
    let store = stores.get(definition.id);
    if (!store) {
      store = createStore<unknown>();
      stores.set(definition.id, store);
    }
    return store as ComponentStore<Value>;
  };

  return {
    create(): Entity {
      const entity = nextEntity++;
      living.add(entity);
      return entity;
    },
    destroy(entity): void {
      living.delete(entity);
      for (const store of stores.values()) store.remove(entity);
    },
    alive: (entity) => living.has(entity),
    get entityCount() { return living.size; },
    store: storeOf,
    add<Value>(entity: Entity, definition: ComponentDef<Value>, value?: Value): Value {
      const initial = value ?? definition.create?.();
      if (initial === undefined) throw new Error(`コンポーネント "${definition.name}" は既定値を持たない。値を渡すこと`);
      return storeOf(definition).add(entity, initial);
    },
    get: <Value>(entity: Entity, definition: ComponentDef<Value>) => storeOf(definition).get(entity),
    has: <Value>(entity: Entity, definition: ComponentDef<Value>) => storeOf(definition).has(entity),
    remove: <Value>(entity: Entity, definition: ComponentDef<Value>) => storeOf(definition).remove(entity),
    entities: () => [...living],
    clear(): void {
      living.clear();
      stores.clear();
      nextEntity = 1;
    },
  };
}
