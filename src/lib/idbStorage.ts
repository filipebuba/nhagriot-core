import type { StateStorage } from "zustand/middleware";

const DB_NAME = "audiobook-web";
const STORE_NAME = "zustand";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = run(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export function createIndexedDbStorage(fallback?: Storage): StateStorage<Promise<void>> {
  return {
    async getItem(name) {
      const value = await withStore<string | undefined>("readonly", (store) => store.get(name));
      if (value != null) return value;
      return fallback?.getItem(name) ?? null;
    },
    async setItem(name, value) {
      await withStore<IDBValidKey>("readwrite", (store) => store.put(value, name));
      fallback?.removeItem(name);
    },
    async removeItem(name) {
      await withStore<undefined>("readwrite", (store) => store.delete(name));
      fallback?.removeItem(name);
    },
  };
}
