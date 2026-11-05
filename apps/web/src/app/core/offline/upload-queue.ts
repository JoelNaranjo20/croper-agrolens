import { Injectable, computed, signal } from '@angular/core';

export interface PendingUpload {
  id: string;
  fieldId: string;
  blob: Blob;
  createdAt: number;
}

const DB_NAME = 'agrolens';
const STORE = 'pending-uploads';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Durable outbox for photos taken without connectivity (common in the field).
 * Photos persist in IndexedDB and are retried when the browser reports it is back online.
 */
@Injectable({ providedIn: 'root' })
export class UploadQueue {
  private readonly items = signal<PendingUpload[]>([]);
  readonly pending = this.items.asReadonly();
  readonly count = computed(() => this.items().length);

  readonly available = typeof indexedDB !== 'undefined';

  async load(): Promise<void> {
    if (!this.available) return;
    this.items.set(await tx<PendingUpload[]>('readonly', (s) => s.getAll()));
  }

  async add(fieldId: string, blob: Blob): Promise<void> {
    const item: PendingUpload = { id: crypto.randomUUID(), fieldId, blob, createdAt: Date.now() };
    await tx('readwrite', (s) => s.put(item));
    this.items.update((xs) => [...xs, item]);
  }

  async remove(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id));
    this.items.update((xs) => xs.filter((x) => x.id !== id));
  }

  forField(fieldId: string) {
    return computed(() => this.items().filter((x) => x.fieldId === fieldId));
  }
}
