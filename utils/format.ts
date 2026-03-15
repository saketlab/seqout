const JOURNAL_ALIASES: Record<string, string> = {
  "Proceedings of the National Academy of Sciences of the United States of America":
    "PNAS",
};

export function cleanJournalName(name: string): string {
  if (JOURNAL_ALIASES[name]) return JOURNAL_ALIASES[name];
  let cleaned = name;
  const colonIndex = cleaned.indexOf(": ");
  if (colonIndex !== -1) cleaned = cleaned.slice(0, colonIndex);
  const parenIndex = cleaned.indexOf("(");
  if (parenIndex !== -1) cleaned = cleaned.slice(0, parenIndex);
  return cleaned.trimEnd();
}

/** Format a large number into a human-readable abbreviated string. */
export function humanize(value: number): string {
  if (value >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000)
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${value}`;
}

const EB = 1e18;
const PB = 1e15;
const TB = 1e12;
const GB = 1e9;
const MB = 1e6;

/** Format a byte count into a human-readable string using binary (1024) units. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val < 10 ? 1 : 0)} ${units[i]}`;
}

/** Format an author list showing only the first and last author. */
export function formatFirstLastAuthor(authors: string | null): string | null {
  if (!authors) return null;
  const list = authors.split(",").map((a) => a.trim()).filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list[0]} ... ${list[list.length - 1]}`;
}

/** Convert an ISO-2 country code to a flag emoji. */
export function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "";
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    ...([...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)),
  );
}

/** Title-case an institute/center name, preserving fully-uppercase words (acronyms). */
export function titleCaseCenter(name: string): string {
  return name
    .split(" ")
    .map((w) => (w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/** Format a byte count into a human-readable abbreviated string. */
export function humanizeBytes(value: number): string {
  if (value >= EB) return `${(value / EB).toFixed(1).replace(/\.0$/, "")} EB`;
  if (value >= PB) return `${(value / PB).toFixed(1).replace(/\.0$/, "")} PB`;
  if (value >= TB) return `${(value / TB).toFixed(1).replace(/\.0$/, "")} TB`;
  if (value >= GB) return `${(value / GB).toFixed(1).replace(/\.0$/, "")} GB`;
  if (value >= MB) return `${(value / MB).toFixed(1).replace(/\.0$/, "")} MB`;
  return `${value}`;
}
