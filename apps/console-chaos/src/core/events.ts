export {
  createEventBus,
  type EventBus,
  type EventMap as EventPayloads,
  type Unsubscribe,
} from '@console-chaos/engine';

export type EventHandler<Value> = (payload: Value) => void;

