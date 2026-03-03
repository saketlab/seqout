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

/** Format a byte count into a human-readable abbreviated string. */
export function humanizeBytes(value: number): string {
  if (value >= EB) return `${(value / EB).toFixed(1).replace(/\.0$/, "")} EB`;
  if (value >= PB) return `${(value / PB).toFixed(1).replace(/\.0$/, "")} PB`;
  if (value >= TB) return `${(value / TB).toFixed(1).replace(/\.0$/, "")} TB`;
  if (value >= GB) return `${(value / GB).toFixed(1).replace(/\.0$/, "")} GB`;
  if (value >= MB) return `${(value / MB).toFixed(1).replace(/\.0$/, "")} MB`;
  return `${value}`;
}
