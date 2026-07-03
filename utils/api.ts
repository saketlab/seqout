import { SERVER_URL } from "@/utils/constants";
import { parseMaybeJson } from "@/utils/json";

// Combine an optional caller signal (React Query passes one) with a 30s timeout
// so superseded/hung requests get aborted instead of clobbering fresh results.
export function withTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(30000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, { signal: withTimeout(signal) });
  if (!res.ok) throw new Error("Network error");
  return (await res.json()) as T;
}

// Like getJson but also returns the X-Total-Count header (full row count before
// pagination), so callers can show the real total while only loading one page.
export async function getJsonWithTotal<T>(
  path: string,
  signal?: AbortSignal,
): Promise<{ items: T; total: number | null }> {
  const res = await fetch(`${SERVER_URL}${path}`, { signal: withTimeout(signal) });
  if (!res.ok) throw new Error("Network error");
  const items = (await res.json()) as T;
  const header = res.headers.get("X-Total-Count");
  return { items, total: header != null ? Number(header) : null };
}

export async function getJsonOrNull<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T | null> {
  const res = await fetch(`${SERVER_URL}${path}`, { signal: withTimeout(signal) });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

// --- Deep dive (ontology hierarchy) ---------------------------------------

export interface DeepDiveTerm {
  term: string; // phrase as it appeared in the query (Select label / swap target)
  name: string; // lowercase graph key
  child_count: number;
}

export interface DeepDiveChild {
  name: string;
  has_children: boolean; // whether this child can expand further
}

/** Query sub-phrases that have hierarchy children in the ontology graph. */
export function getDeepDiveTerms(q: string, signal?: AbortSignal) {
  return getJson<{ terms: DeepDiveTerm[]; took_ms: number }>(
    `/search/deep-dive/terms?q=${encodeURIComponent(q)}`,
    signal,
  );
}

/** Direct children of a graph term (synonym-transparent, lazy expansion). */
export function getDeepDiveChildren(term: string, signal?: AbortSignal) {
  return getJson<{ term: string; children: DeepDiveChild[]; took_ms: number }>(
    `/search/deep-dive/children?term=${encodeURIComponent(term)}`,
    signal,
  );
}

const NOT_JSON = Symbol("not-json");

export function parseProjectStringFields<T>(data: T): T {
  const d = data as Record<string, unknown>;
  if (!d) return data;

  if (typeof d.external_id === "string") {
    d.external_id = parseMaybeJson(d.external_id, null);
  }
  if (typeof d.links === "string") {
    d.links = parseMaybeJson(d.links, null);
  }
  if (typeof d.neighbors === "string") {
    d.neighbors = parseMaybeJson(d.neighbors, null);
  }
  if (typeof d.organisms === "string") {
    const text = d.organisms;
    const parsed = parseMaybeJson<unknown>(text, NOT_JSON);
    d.organisms =
      parsed === NOT_JSON
        ? text
            .split(/[;,|]/)
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
        : parsed;
  }

  return data;
}
