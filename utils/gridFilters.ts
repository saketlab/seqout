export type ServerFilter = { c: string; o: "equals" | "contains"; v: string };

/** The slice of AG Grid's filter model this translates: single-condition text. */
type TextFilterModel = {
  filterType?: string;
  type?: string;
  filter?: unknown;
};

/**
 * Translate AG Grid's filter model into the payload the /find endpoints take.
 *
 * Only single-condition text filters cross the wire. Number ranges, and any
 * column the server does not know about, are left to the grid — which re-applies
 * the whole model to whatever comes back, so the server only ever has to return
 * a superset.
 *
 * Returns "" when nothing is translatable, which callers treat as "no lookup".
 */
export const toServerFilters = (
  model: Record<string, unknown> | null | undefined,
): string => {
  const filters: ServerFilter[] = [];
  for (const [colId, entry] of Object.entries(model ?? {})) {
    const f = entry as TextFilterModel;
    if (f?.filterType !== "text") continue;
    if (f.type !== "equals" && f.type !== "contains") continue;
    const value = typeof f.filter === "string" ? f.filter.trim() : "";
    if (!value) continue;
    filters.push({ c: colId, o: f.type, v: value });
  }
  return filters.length > 0 ? JSON.stringify(filters) : "";
};
