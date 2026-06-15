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
