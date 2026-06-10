/**
 * Browser caching for the JSON map assets (geojson + country list) using the
 * Cache Storage API. Entries are keyed by their full versioned URL, so a new
 * backend version or a bumped purge-revision yields a fresh URL and a fresh
 * fetch automatically. `purgeMapCache` drops everything so the next load
 * re-fetches from the server.
 *
 * (The Arrow tiles are fetched internally by deepscatter and are cached by the
 * browser's HTTP cache via the backend's immutable Cache-Control headers; the
 * purge revision in their URL is what forces those to refetch.)
 */
const CACHE_NAME = "seqout-map";
const REV_KEY = "seqout-map-rev";
const DEFAULT_REV = "s";

/** Current purge revision (persisted). Part of every asset URL. */
export function getMapRev(): string {
  if (typeof localStorage === "undefined") return DEFAULT_REV;
  return localStorage.getItem(REV_KEY) || DEFAULT_REV;
}

/** Fetch JSON, serving from (and populating) the Cache Storage entry for `url`. */
export async function cachedJson<T = unknown>(url: string): Promise<T> {
  if (typeof caches === "undefined") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.json() as Promise<T>;
  }

  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(url);
  if (hit) return hit.json() as Promise<T>;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  await cache.put(url, res.clone());
  return res.json() as Promise<T>;
}

/**
 * Purge cached map assets and bump the purge revision so the next load fetches
 * everything fresh (JSON from the network, tiles past the HTTP cache).
 */
export async function purgeMapCache(): Promise<void> {
  if (typeof caches !== "undefined") {
    await caches.delete(CACHE_NAME);
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(REV_KEY, String(Date.now()));
  }
}
