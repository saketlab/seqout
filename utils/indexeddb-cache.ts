const CACHE_DB_NAME = "seqout-http-cache";
const CACHE_DB_VERSION = 1;
const CACHE_STORE = "json-responses";

// Bump this number whenever the shape of a cached endpoint changes on the
// backend in a way that makes old payloads wrong. Every increment wipes
// every existing IndexedDB entry and forces a one-time refetch.
//
// History:
//   v1: initial (no TTL, no version-bump discipline)
//   v2: added 7-day TTL + invalidated stale /stats/platform-* responses
//       that were captured before instrument drill-down was deployed
const CACHE_RECORD_VERSION = 2;

// Maximum age for a cached response. Stats endpoints refresh weekly, so
// a 7-day ceiling keeps users within one refresh window of truth without
// re-fetching unnecessarily.
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface JsonCacheRecord<T> {
  version: number;
  savedAt: number;
  payload: T;
}

function openCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open cache database."));
  });
}

async function readCachedJson<T>(
  key: string,
): Promise<JsonCacheRecord<T> | null> {
  const db = await openCacheDb();
  if (!db) return null;

  try {
    const record = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, "readonly");
      const store = tx.objectStore(CACHE_STORE);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to read cache."));
      tx.onabort = () =>
        reject(tx.error ?? new Error("Reading cache was aborted."));
    });

    if (!record || typeof record !== "object") return null;
    const parsed = record as Partial<JsonCacheRecord<T>>;
    if (
      parsed.version !== CACHE_RECORD_VERSION ||
      typeof parsed.savedAt !== "number" ||
      !Number.isFinite(parsed.savedAt) ||
      !("payload" in parsed)
    ) {
      return null;
    }

    // Expire stale entries automatically so the frontend eventually
    // catches up with backend changes even if the cache version isn't
    // bumped on every deploy.
    if (Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) {
      return null;
    }

    return parsed as JsonCacheRecord<T>;
  } finally {
    db.close();
  }
}

async function writeCachedJson<T>(key: string, payload: T): Promise<void> {
  const db = await openCacheDb();
  if (!db) return;

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, "readwrite");
      const store = tx.objectStore(CACHE_STORE);
      const value: JsonCacheRecord<T> = {
        version: CACHE_RECORD_VERSION,
        savedAt: Date.now(),
        payload,
      };

      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("Failed to write cache."));
      tx.onabort = () =>
        reject(tx.error ?? new Error("Writing cache was aborted."));
    });
  } finally {
    db.close();
  }
}

export async function fetchJsonWithIndexedDbCache<T>(url: string): Promise<T> {
  try {
    const cached = await readCachedJson<T>(url);
    if (cached) {
      return cached.payload;
    }
  } catch {
    // Ignore cache read errors and continue with network fetch.
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed request: ${res.status}`);
  }

  const payload = (await res.json()) as T;

  try {
    await writeCachedJson(url, payload);
  } catch {
    // Ignore cache write errors.
  }

  return payload;
}
