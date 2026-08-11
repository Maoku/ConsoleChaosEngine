export interface ComponentDef<Value> {
  readonly id: number;
  readonly name: string;
  readonly create?: () => Value;
}

let nextComponentId = 0;

export function defineComponent<Value>(name: string, create?: () => Value): ComponentDef<Value> {
  return create ? { id: nextComponentId++, name, create } : { id: nextComponentId++, name };
}

export function resetComponentIds(): void {
  nextComponentId = 0;
}

