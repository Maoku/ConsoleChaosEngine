export interface AssetHandle<Value> {
  readonly key: string;
  readonly value: Value;
  release(): void;
}

interface AssetEntry {
  promise: Promise<unknown>;
  value?: unknown;
  references: number;
  dispose?: (value: unknown) => void;
}

export interface AssetManager {
  acquire<Value>(key: string, load: () => Promise<Value>, dispose?: (value: Value) => void): Promise<AssetHandle<Value>>;
  loadJson<Value>(url: string): Promise<AssetHandle<Value>>;
  readonly activeCount: number;
  dispose(): void;
}

export function createAssetManager(fetcher: typeof fetch = fetch): AssetManager {
  const entries = new Map<string, AssetEntry>();

  const acquire = async <Value>(key: string, load: () => Promise<Value>, dispose?: (value: Value) => void): Promise<AssetHandle<Value>> => {
    let entry = entries.get(key);
    if (!entry) {
      const next: AssetEntry = { promise: Promise.resolve().then(load), references: 0 };
      if (dispose) next.dispose = (value) => dispose(value as Value);
      next.promise = next.promise.then((value) => {
        next.value = value;
        return value;
      }).catch((error: unknown) => {
        entries.delete(key);
        throw error;
      });
      entries.set(key, next);
      entry = next;
    }
    entry.references++;
    const value = await entry.promise as Value;
    let released = false;
    return {
      key,
      value,
      release(): void {
        if (released) return;
        released = true;
        const current = entries.get(key);
        if (!current) return;
        current.references--;
        if (current.references <= 0) {
          if (current.value !== undefined) current.dispose?.(current.value);
          entries.delete(key);
        }
      },
    };
  };

  return {
    acquire,
    loadJson: <Value>(url: string) => acquire(url, async () => {
      const response = await fetcher(url);
      if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`);
      return response.json() as Promise<Value>;
    }),
    get activeCount() {
      return entries.size;
    },
    dispose(): void {
      for (const entry of entries.values()) {
        if (entry.value !== undefined) entry.dispose?.(entry.value);
      }
      entries.clear();
    },
  };
}
