// Fila de sync DURÁVEL (IndexedDB). Guarda apenas os IDs locais pendentes de
// upsert/delete no Supabase — os DADOS dos livros já estão persistidos no store
// da biblioteca. Objetivo: sobreviver a fechamento súbito do app E a conexões
// ruins. Ao reabrir, os IDs são reenfileirados e reenviados quando der.
//
// Tudo best-effort: se o IndexedDB falhar, o sync ainda funciona em memória
// (só perde a durabilidade entre sessões).

const DB_NAME = "nhagriot-sync-queue";
const STORE = "queue";
const KEY = "books";
const VERSION = 1;

export interface SyncQueueShape {
  upserts: string[];
  deletes: string[];
}

const EMPTY: SyncQueueShape = { upserts: [], deletes: [] };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadSyncQueue(): Promise<SyncQueueShape> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => {
        const v = req.result as SyncQueueShape | undefined;
        resolve({
          upserts: Array.isArray(v?.upserts) ? v!.upserts : [],
          deletes: Array.isArray(v?.deletes) ? v!.deletes : [],
        });
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return { ...EMPTY };
  }
}

export async function saveSyncQueue(q: SyncQueueShape): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ upserts: q.upserts, deletes: q.deletes }, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Silencioso — durabilidade é um plus, não pode quebrar o sync.
  }
}
