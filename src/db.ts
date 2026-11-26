// IndexedDB persistence. Everything (extracted text, chunks, outlines,
// storyboards, per-scene audio) lives here so a reload or crash loses nothing
// and a failed job resumes exactly where it stopped. Audio is keyed by a hash
// of scene text + voice so identical narration is never regenerated.

const DB_NAME = 'illg-db';
const DB_VERSION = 1;

export const STORES = {
  meta: 'meta', // key-value: document, pages, chunks, chapters, jobState, settings
  outlines: 'outlines', // key: chapterId
  storyboards: 'storyboards', // key: chapterId
  audio: 'audio', // key: audioHash -> { hash, chapterId, sceneId, voice, blob, durationSeconds, fallback }
  qa: 'qa', // cached Q&A: key: question hash
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out as T);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await tx(STORES.meta, 'readwrite', (s) => { s.put(value, key); });
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORES.meta, 'readonly');
    const req = t.objectStore(STORES.meta).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function setOutline(chapterId: string, outline: unknown): Promise<void> {
  await tx(STORES.outlines, 'readwrite', (s) => { s.put(outline, chapterId); });
}

export async function getOutline<T>(chapterId: string): Promise<T | undefined> {
  const db = await open();
  return reqToPromise(db.transaction(STORES.outlines, 'readonly').objectStore(STORES.outlines).get(chapterId)) as Promise<T | undefined>;
}

export async function setStoryboard(chapterId: string, sb: unknown): Promise<void> {
  await tx(STORES.storyboards, 'readwrite', (s) => { s.put(sb, chapterId); });
}

export async function getStoryboard<T>(chapterId: string): Promise<T | undefined> {
  const db = await open();
  return reqToPromise(db.transaction(STORES.storyboards, 'readonly').objectStore(STORES.storyboards).get(chapterId)) as Promise<T | undefined>;
}

export interface AudioRecord {
  hash: string;
  chapterId: string;
  sceneId: string;
  voice: string;
  blob: Blob;
  durationSeconds: number;
  fallback: boolean; // true if produced by Web Speech API fallback
}

export async function setAudio(rec: AudioRecord): Promise<void> {
  await tx(STORES.audio, 'readwrite', (s) => { s.put(rec, rec.hash); });
}

export async function getAudio(hash: string): Promise<AudioRecord | undefined> {
  const db = await open();
  return reqToPromise(db.transaction(STORES.audio, 'readonly').objectStore(STORES.audio).get(hash)) as Promise<AudioRecord | undefined>;
}

export async function getAudioForScene(chapterId: string, sceneId: string): Promise<AudioRecord | undefined> {
  const db = await open();
  const all = await reqToPromise(db.transaction(STORES.audio, 'readonly').objectStore(STORES.audio).getAll()) as AudioRecord[];
  return all.find((a) => a.chapterId === chapterId && a.sceneId === sceneId && !a.fallback)
    ?? all.find((a) => a.chapterId === chapterId && a.sceneId === sceneId);
}

export async function listAudio(): Promise<AudioRecord[]> {
  const db = await open();
  return reqToPromise(db.transaction(STORES.audio, 'readonly').objectStore(STORES.audio).getAll()) as Promise<AudioRecord[]>;
}

export async function deleteAudio(hash: string): Promise<void> {
  await tx(STORES.audio, 'readwrite', (s) => { s.delete(hash); });
}

export async function setQA(key: string, value: unknown): Promise<void> {
  await tx(STORES.qa, 'readwrite', (s) => { s.put(value, key); });
}

export async function getQA<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return reqToPromise(db.transaction(STORES.qa, 'readonly').objectStore(STORES.qa).get(key)) as Promise<T | undefined>;
}

export async function clearAll(): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(Object.values(STORES), 'readwrite');
    for (const s of Object.values(STORES)) t.objectStore(s).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// Stable hash for audio cache keys (scene text + voice).
export async function hashString(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
