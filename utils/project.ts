type AuthorsInput = string | string[] | null | undefined;

export const normalizeAuthors = (value: AuthorsInput): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((author) => author.trim()).filter(Boolean);
  }

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((author): author is string => typeof author === "string")
        .map((author) => author.trim())
        .filter(Boolean);
    }
  } catch {}

  return trimmed
    .split(",")
    .map((author) => author.trim())
    .filter(Boolean);
};

export const authorHref = (name: string): string =>
  `/authors/${encodeURIComponent(name.trim())}`;

export const pmidHref = (pmid: string | number): string =>
  `/publications/${encodeURIComponent(String(pmid).trim())}`;

export const isPmid = (value: string): boolean => /^\d+$/.test(value.trim());

export const pubmedHref = (pmid: string | number): string =>
  `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(String(pmid).trim())}`;

export const doiHref = (doi: string): string => `https://doi.org/${doi.trim()}`;

export const toDisplayText = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
};

export const parsePostgresTextArray = (value: string): string[] => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return [];
  }

  const content = trimmed.slice(1, -1);
  if (!content) {
    return [];
  }

  const items: string[] = [];
  let current = "";
  let inQuotes = false;
  let escaped = false;

  for (const char of content) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      if (inQuotes) {
        escaped = true;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      if (current.trim()) {
        items.push(current.trim());
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    items.push(current.trim());
  }

  return items;
};

export const normalizeAliases = (
  value: string | string[] | null | undefined,
): string[] => {
  if (!value) return [];

  const candidates = Array.isArray(value)
    ? value
    : (() => {
        const trimmed = value.trim();
        if (!trimmed) return [];

        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (Array.isArray(parsed)) {
            return parsed
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim());
          }
        } catch {
          // fall through to postgres/text parsing
        }

        const postgresArrayItems = parsePostgresTextArray(trimmed);
        if (postgresArrayItems.length > 0) {
          return postgresArrayItems;
        }

        return [trimmed];
      })();

  const deduped = new Set<string>();
  candidates
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0)
    .forEach((alias) => deduped.add(alias));
  return Array.from(deduped);
};
