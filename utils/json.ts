export function parseMaybeJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Serializes JSON for embedding in an HTML <script> element.
 *
 * JSON.stringify alone leaves HTML-significant characters intact, allowing a
 * value such as </script> to close the element early. JSON parsers treat the
 * Unicode escapes below as the original characters after the script is read.
 */
export function escapeHtmlJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
