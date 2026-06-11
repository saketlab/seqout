/**
 * URL-hash encoding for sharable sections.
 *
 * A plain section link is just the section id (e.g. `#samples`). When a section
 * has a tabbed table (Original / Enriched), the active tab is appended after an
 * `=` so the selection can be restored from the URL (e.g. `#samples=enriched`).
 */
export function buildSectionHash(id: string, tab?: string): string {
  return tab ? `${id}=${tab}` : id;
}

export function parseSectionHash(hash: string): { id: string; tab?: string } {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [id, tab] = raw.split("=");
  return { id: id ?? "", tab: tab || undefined };
}
