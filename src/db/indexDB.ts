const DB_NAME = 'stock-mock-db';
const DB_VERSION = 2;

export const STORE = {
  stocks: 'stocks',
  bars: 'bars',
  forecasts: 'forecasts',
  aiConfigs: 'aiConfigs',
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE.stocks)) {
          db.createObjectStore(STORE.stocks, { keyPath: 'id' });
        }
        for (const name of [STORE.bars, STORE.forecasts] as const) {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: 'key' });
            store.createIndex('byStock', 'stockId', { unique: false });
          }
        }
        if (!db.objectStoreNames.contains(STORE.aiConfigs)) {
          const store = db.createObjectStore(STORE.aiConfigs, { keyPath: 'stockId' });
          store.createIndex('byStock', 'stockId', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB 被其它页面占用，请关闭其它标签页后重试'));
    });
  }
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDB();
  const tx = db.transaction(store, 'readonly');
  return promisify(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function getAllByIndex<T>(store: StoreName, index: string, value: IDBValidKey): Promise<T[]> {
  const db = await openDB();
  const tx = db.transaction(store, 'readonly');
  return promisify(tx.objectStore(store).index(index).getAll(value) as IDBRequest<T[]>);
}

export async function putOne<T>(store: StoreName, value: T): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value as unknown as Record<string, unknown>);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function putMany<T>(store: StoreName, values: T[]): Promise<void> {
  if (!values.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const objectStore = tx.objectStore(store);
  values.forEach((value) => objectStore.put(value as unknown as Record<string, unknown>));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteOne(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 删除某个 store 中属于指定 stockId 的所有记录 */
export async function deleteByStock(store: StoreName, stockId: string): Promise<number> {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const index = tx.objectStore(store).index('byStock');
  let count = 0;
  await new Promise<void>((resolve, reject) => {
    const cursorReq = index.openKeyCursor(IDBKeyRange.only(stockId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      tx.objectStore(store).delete(cursor.primaryKey);
      count += 1;
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return count;
}

export async function clearStore(store: StoreName): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
