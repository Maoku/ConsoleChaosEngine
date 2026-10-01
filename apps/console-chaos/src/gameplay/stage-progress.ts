export interface StageProgress {
  readonly completed: ReadonlySet<string>;
  grant(id: string): boolean;
  satisfies(required: readonly string[]): boolean;
  restore(ids: readonly string[]): void;
}

/** Only declared achievements can be granted; restores never emit new-achievement events. */
export function createStageProgress(known: readonly string[]): StageProgress {
  const allowed = new Set(known);
  const completed = new Set<string>();
  return {
    completed,
    grant(id) {
      if (!allowed.has(id)) throw new Error('未知の成果: ' + id);
      if (completed.has(id)) return false;
      completed.add(id);
      return true;
    },
    satisfies: (required) => required.every((id) => completed.has(id)),
    restore(ids) {
      if (ids.some((id) => !allowed.has(id))) throw new Error('未知の保存成果');
      completed.clear();
      for (const id of ids) completed.add(id);
    },
  };
}
