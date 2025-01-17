/*
usage:
  const store = await objectStorage<MyObject>({store: 'my-store'});
  const value = await store.get(key);
*/

export interface DbInfo {
  store: string;
  db?: string; // default `${store}--db`
  version?: number; // default 1
  indices?: { name: string; keyPath: string | string[]; options?: IDBIndexParameters }[];
  upgrade?: (e: IDBVersionChangeEvent, store?: IDBObjectStore) => void;
}

export interface ObjectStorage<V, K extends IDBValidKey = IDBValidKey> {
  list(): Promise<K[]>;
  get(key: K): Promise<V>;
  getMany(keys?: IDBKeyRange): Promise<V[]>;
  put(key: K, value: V): Promise<K>; // returns key
  count(key?: K | IDBKeyRange): Promise<number>;
  remove(key: K | IDBKeyRange): Promise<void>;
  clear(): Promise<void>; // remove all
  cursor(o: CursorOpts): Promise<IDBCursorWithValue | undefined>;
  txn(mode: IDBTransactionMode): IDBTransaction; // do anything else
}

interface CursorOpts {
  index?: string;
  keys?: IDBKeyRange;
  dir?: IDBCursorDirection;
  write?: boolean;
}

export async function objectStorage<V, K extends IDBValidKey = IDBValidKey>(
  dbInfo: DbInfo,
): Promise<ObjectStorage<V, K>> {
  const db = await dbConnect(dbInfo);

  function objectStore(mode: IDBTransactionMode) {
    return db.transaction(dbInfo.store, mode).objectStore(dbInfo.store);
  }

  function actionPromise<V>(f: () => IDBRequest) {
    return new Promise<V>((resolve, reject) => {
      const res = f();
      res.onsuccess = (e: Event) => resolve((e.target as IDBRequest).result);
      res.onerror = (e: Event) => reject((e.target as IDBRequest).result);
    });
  }

  return {
    list: () => actionPromise<K[]>(() => objectStore('readonly').getAllKeys()),
    get: (key: K) => actionPromise<V>(() => objectStore('readonly').get(key)),
    getMany: (keys?: IDBKeyRange) => actionPromise<V[]>(() => objectStore('readonly').getAll(keys)),
    put: (key: K, value: V) => actionPromise<K>(() => objectStore('readwrite').put(value, key)),
    count: (key?: K | IDBKeyRange) => actionPromise<number>(() => objectStore('readonly').count(key)),
    remove: (key: K | IDBKeyRange) => actionPromise<void>(() => objectStore('readwrite').delete(key)),
    clear: () => actionPromise<void>(() => objectStore('readwrite').clear()),
    cursor: ({ index, keys, dir, write }: CursorOpts) =>
      actionPromise<IDBCursorWithValue | undefined>(() => {
        const store = objectStore(write ? 'readwrite' : 'readonly');
        return index ? store.index(index).openCursor(keys, dir) : store.openCursor(keys, dir);
      }),
    txn: (mode: IDBTransactionMode) => db.transaction(dbInfo.store, mode),
  };
}

export async function dbConnect(dbInfo: DbInfo): Promise<IDBDatabase> {
  const dbName = dbInfo?.db || `${dbInfo.store}--db`;

  return new Promise<IDBDatabase>((resolve, reject) => {
    const result = window.indexedDB.open(dbName, dbInfo?.version ?? 1);

    result.onsuccess = (e: Event) => resolve((e.target as IDBOpenDBRequest).result);
    result.onerror = (e: Event) => reject((e.target as IDBOpenDBRequest).error ?? 'IndexedDB Unavailable');
    result.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const db = (e.target as IDBOpenDBRequest).result;
      const txn = (e.target as IDBOpenDBRequest).transaction;
      const store = db.objectStoreNames.contains(dbInfo.store)
        ? txn!.objectStore(dbInfo.store)
        : db.createObjectStore(dbInfo.store);

      const existing = new Set(store.indexNames);

      dbInfo.indices?.forEach(({ name, keyPath, options }) => {
        if (!existing.has(name)) store.createIndex(name, keyPath, options);
        else {
          const i = store.index(name);
          if (
            i.keyPath !== keyPath ||
            i.unique !== !!options?.unique ||
            i.multiEntry !== !!options?.multiEntry
          ) {
            store.deleteIndex(name);
            store.createIndex(name, keyPath, options);
          }
        }
        existing.delete(name);
      });

      existing.forEach(indexName => store.deleteIndex(indexName));
      dbInfo.upgrade?.(e, store);
    };
  });
}

export async function nonEmptyStore(info: DbInfo): Promise<boolean> {
  const dbName = info?.db || `${info.store}--db`;
  return new Promise<boolean>(resolve => {
    // https://developer.mozilla.org/en-US/docs/Web/API/IDBFactory/databases#browser_compatibility
    const dbs = window.indexedDB.databases?.();
    if (!dbs) storeExists();
    else
      dbs.then(dbList => {
        if (dbList.every(db => db.name !== dbName)) resolve(false);
        else storeExists();
      });

    function storeExists() {
      const request = window.indexedDB.open(dbName);

      request.onerror = () => resolve(false);
      request.onsuccess = (e: Event) => {
        const db = (e.target as IDBOpenDBRequest).result;
        try {
          const cursor = db.transaction(info.store, 'readonly').objectStore(info.store).openCursor();
          cursor.onsuccess = () => {
            db.close();
            resolve(cursor.result !== null);
          };
        } catch {
          db.close();
          resolve(false);
        }
      };
    }
  });
}
