import { SERVER_URL } from "@/utils/constants";
import { parseMaybeJson } from "@/utils/json";

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`);
  if (!res.ok) throw new Error("Network error");
  return (await res.json()) as T;
}

export async function getJsonOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(`${SERVER_URL}${path}`);
  if (!res.ok) return null;
  return (await res.json()) as T;
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
