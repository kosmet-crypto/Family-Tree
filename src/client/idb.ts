// Tiny promise wrapper around one IndexedDB object store (key -> value).

const DB_NAME = "roots-branches";
const STORE = "kv";
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const idb = {
  get: <T>(key: string) => run<T | undefined>("readonly", (s) => s.get(key)),
  set: (key: string, value: unknown) => run<IDBValidKey>("readwrite", (s) => s.put(value, key)),
  del: (key: string) => run<undefined>("readwrite", (s) => s.delete(key)),
  keys: () => run<IDBValidKey[]>("readonly", (s) => s.getAllKeys()),
};
