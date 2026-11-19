/**
 * Tiny async key-value adapter.
 *  - native: expo-sqlite's SQLite-backed `Storage` (expo-sqlite/kv-store)
 *  - web: window.localStorage (avoids the wasm SQLite worker for a few KB of JSON)
 *  - anything failing: in-memory map (fail soft, the app still runs)
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const memory = new Map<string, string>();
const memoryStore: KeyValueStore = {
  async getItem(k) {
    return memory.has(k) ? (memory.get(k) as string) : null;
  },
  async setItem(k, v) {
    memory.set(k, v);
  },
  async removeItem(k) {
    memory.delete(k);
  },
};

function isWeb(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

let resolved: KeyValueStore | null = null;

function resolveStore(): KeyValueStore {
  if (resolved) return resolved;
  try {
    if (isWeb()) {
      const ls = (globalThis as { localStorage?: Storage }).localStorage;
      if (ls) {
        resolved = {
          async getItem(k) {
            return ls.getItem(k);
          },
          async setItem(k, v) {
            ls.setItem(k, v);
          },
          async removeItem(k) {
            ls.removeItem(k);
          },
        };
        return resolved;
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('expo-sqlite/kv-store') as typeof import('expo-sqlite/kv-store');
      const s = mod.Storage;
      resolved = {
        getItem: (k) => s.getItemAsync(k),
        setItem: (k, v) => s.setItemAsync(k, v),
        removeItem: async (k) => {
          await s.removeItemAsync(k);
        },
      };
      return resolved;
    }
  } catch {
    // fall through
  }
  resolved = memoryStore;
  return resolved;
}

/** Wraps every call so a broken backend degrades to memory instead of throwing. */
export const kv: KeyValueStore = {
  async getItem(k) {
    try {
      return await resolveStore().getItem(k);
    } catch {
      resolved = memoryStore;
      return memoryStore.getItem(k);
    }
  },
  async setItem(k, v) {
    try {
      await resolveStore().setItem(k, v);
    } catch {
      resolved = memoryStore;
      await memoryStore.setItem(k, v);
    }
  },
  async removeItem(k) {
    try {
      await resolveStore().removeItem(k);
    } catch {
      await memoryStore.removeItem(k);
    }
  },
};
