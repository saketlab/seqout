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

/**
 * Publication date -> "2 Aug 2017", formatting only shapes we recognise and
 * passing anything else through untouched.
 *
 * Never hand an unrecognised string to `new Date`: V8 scavenges digits out of
 * junk rather than rejecting it, so "Spring 2017" becomes 1 Jan 2017 and
 * "2017 Jun" becomes 1 Jun 2017 — both invent a day PubMed never stated, and
 * neither trips a NaN check. Same reason a bare year is returned as-is:
 * `new Date(2017)` is 1 Jan 1970. Recognised dates are pinned to UTC so a
 * date-only value doesn't slip back a day for viewers west of Greenwich.
 */
export function formatPubDate(value: string | number | null): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // "2017"
  if (/^\d{4}$/.test(raw)) return raw;

  // "2017-08" — month precision only; don't imply a day
  if (/^\d{4}-\d{2}$/.test(raw)) {
    return new Date(`${raw}-01T00:00:00Z`).toLocaleDateString("en-GB", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  // "2017-08-02"
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  return raw;
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
  const list = authors
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
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
    ...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

/** Title-case an institute/center name, preserving fully-uppercase words (acronyms). */
export function titleCaseCenter(name: string): string {
  return name
    .split(" ")
    .map((w) =>
      w === w.toUpperCase()
        ? w
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
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
