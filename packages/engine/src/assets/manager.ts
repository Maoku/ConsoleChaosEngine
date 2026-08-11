import { loadGltf as loadGltfModel, type GltfIO, type GltfModel } from './gltf';

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
  restore?: () => Promise<unknown> | unknown;
  gpu: boolean;
}

export interface AssetManager {
  acquire<Value>(key: string, load: () => Promise<Value>, dispose?: (value: Value) => void): Promise<AssetHandle<Value>>;
  acquireGpu<Value>(
    key: string,
    create: () => Promise<Value> | Value,
    dispose: (value: Value) => void,
  ): Promise<AssetHandle<Value>>;
  loadJson<Value>(url: string): Promise<AssetHandle<Value>>;
  loadText(url: string): Promise<AssetHandle<string>>;
  loadBinary(url: string): Promise<AssetHandle<ArrayBuffer>>;
  loadImage(url: string): Promise<AssetHandle<ImageBitmap>>;
  loadGltf(url: string, io?: GltfIO): Promise<AssetHandle<GltfModel>>;
  restoreGpuResources(): Promise<void>;
  readonly activeCount: number;
  readonly gpuCount: number;
  dispose(): void;
}

export function createAssetManager(fetcher: typeof fetch = fetch): AssetManager {
  const entries = new Map<string, AssetEntry>();
  let disposed = false;

  const acquireEntry = async <Value>(
    key: string,
    load: () => Promise<Value> | Value,
    dispose?: (value: Value) => void,
    gpu = false,
  ): Promise<AssetHandle<Value>> => {
    if (disposed) throw new Error('AssetManager is disposed');
    let entry = entries.get(key);
    if (!entry) {
      const next: AssetEntry = {
        promise: Promise.resolve().then(load),
        references: 0,
        gpu,
      };
      if (dispose) next.dispose = (value) => dispose(value as Value);
      if (gpu) next.restore = load;
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
    await entry.promise;
    let released = false;
    return {
      key,
      get value() {
        return entry?.value as Value;
      },
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

  const response = async (url: string): Promise<Response> => {
    const result = await fetcher(url);
    if (!result.ok) throw new Error(`Unable to load ${url}: ${result.status}`);
    return result;
  };

  return {
    acquire: (key, load, release) => acquireEntry(key, load, release),
    acquireGpu: (key, create, release) => acquireEntry(`gpu:${key}`, create, release, true),
    loadJson: <Value>(url: string) => acquireEntry(url, async () => (await response(url)).json() as Promise<Value>),
    loadText: (url) => acquireEntry(url, async () => (await response(url)).text()),
    loadBinary: (url) => acquireEntry(url, async () => (await response(url)).arrayBuffer()),
    loadImage: (url) => acquireEntry(`image:${url}`, async () => {
      const bitmapFactory = globalThis.createImageBitmap;
      if (!bitmapFactory) throw new Error('createImageBitmap is unavailable');
      return bitmapFactory(await (await response(url)).blob());
    }, (bitmap) => bitmap.close()),
    loadGltf: (url, io) => acquireEntry(`gltf:${url}`, () => loadGltfModel(url, io)),
    async restoreGpuResources(): Promise<void> {
      for (const entry of entries.values()) {
        if (!entry.gpu || !entry.restore) continue;
        const previous = entry.value;
        const next = await entry.restore();
        entry.value = next;
        entry.promise = Promise.resolve(next);
        if (previous !== undefined && previous !== next) entry.dispose?.(previous);
      }
    },
    get activeCount() {
      return entries.size;
    },
    get gpuCount() {
      let count = 0;
      for (const entry of entries.values()) if (entry.gpu) count++;
      return count;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) {
        if (entry.value !== undefined) entry.dispose?.(entry.value);
      }
      entries.clear();
    },
  };
}
