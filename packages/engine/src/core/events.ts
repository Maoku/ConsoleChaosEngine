export type EventMap = object;
export type Unsubscribe = () => void;

export interface EventBus<Events extends EventMap> {
  on<Key extends keyof Events>(type: Key, handler: (payload: Events[Key]) => void): Unsubscribe;
  once<Key extends keyof Events>(type: Key, handler: (payload: Events[Key]) => void): Unsubscribe;
  off<Key extends keyof Events>(type: Key, handler: (payload: Events[Key]) => void): void;
  emit<Key extends keyof Events>(type: Key, payload: Events[Key]): void;
  clear(type?: keyof Events): void;
  listenerCount(type: keyof Events): number;
}

export function createEventBus<Events extends EventMap>(): EventBus<Events> {
  type Handler = (payload: never) => void;
  const handlers = new Map<keyof Events, Handler[]>();

  const remove = <Key extends keyof Events>(type: Key, handler: (payload: Events[Key]) => void): void => {
    const listeners = handlers.get(type);
    const index = listeners?.indexOf(handler as Handler) ?? -1;
    if (index >= 0) listeners?.splice(index, 1);
  };

  const on = <Key extends keyof Events>(type: Key, handler: (payload: Events[Key]) => void): Unsubscribe => {
    const listeners = handlers.get(type) ?? [];
    if (!handlers.has(type)) handlers.set(type, listeners);
    listeners.push(handler as Handler);
    return () => remove(type, handler);
  };

  return {
    on,
    once<Key extends keyof Events>(type: Key, handler: (payload: Events[Key]) => void): Unsubscribe {
      let unsubscribe: Unsubscribe = () => {};
      unsubscribe = on(type, (payload) => {
        unsubscribe();
        handler(payload);
      });
      return unsubscribe;
    },
    off: remove,
    emit<Key extends keyof Events>(type: Key, payload: Events[Key]): void {
      for (const handler of [...(handlers.get(type) ?? [])]) {
        (handler as (value: Events[Key]) => void)(payload);
      }
    },
    clear(type): void {
      if (type === undefined) handlers.clear();
      else handlers.delete(type);
    },
    listenerCount: (type) => handlers.get(type)?.length ?? 0,
  };
}
