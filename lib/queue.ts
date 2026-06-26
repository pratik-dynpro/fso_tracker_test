'use client';
import { openDB, type IDBPDatabase } from 'idb';
import type { TrackPoint } from './types';

const DB_NAME = 'mccarthy-gps';
const STORE = 'queue';

let _db: Promise<IDBPDatabase> | null = null;
function db() {
  if (!_db) {
    _db = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return _db;
}

/** Add one reading to the on-device queue. */
export async function enqueue(point: TrackPoint): Promise<void> {
  const d = await db();
  await d.add(STORE, point);
}

/** Read up to `limit` queued readings together with their keys. */
export async function peekBatch(
  limit = 200
): Promise<{ key: IDBValidKey; point: TrackPoint }[]> {
  const d = await db();
  const keys = await d.getAllKeys(STORE);
  const vals = (await d.getAll(STORE)) as TrackPoint[];
  return keys.slice(0, limit).map((k, i) => ({ key: k, point: vals[i] }));
}

/** Remove successfully-sent readings from the queue. */
export async function removeKeys(keys: IDBValidKey[]): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE, 'readwrite');
  for (const k of keys) tx.store.delete(k);
  await tx.done;
}

export async function queueCount(): Promise<number> {
  const d = await db();
  return d.count(STORE);
}
