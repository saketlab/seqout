export function exportExperimentsToCsv(
  experiments: Record<string, unknown>[] | null | undefined,
  filename = "experiments.csv"
) {
  if (!experiments || experiments.length === 0) {
    // nothing to export
    return;
  }

  // Use keys from the first object to define header order
  const headers = Object.keys(experiments[0]);

  const escapeCell = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const s = String(value as unknown);
    // Escape double quotes by doubling them
    const escaped = s.replace(/"/g, '""');
    // Wrap in quotes if it contains comma, quote or newline
    if (
      escaped.includes(",") ||
      escaped.includes('"') ||
      escaped.includes("\n")
    ) {
      return `"${escaped}"`;
    }
    return escaped;
  };

  const rows = [headers.join(",")];
  for (const item of experiments) {
    const row = headers.map((h) => escapeCell(item[h]));
    rows.push(row.join(","));
  }

  const csv = rows.join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // release the URL
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Write rows to a CSV under an explicit header list.
 *
 * Unlike exportExperimentsToCsv, the columns are given rather than read off the
 * first row — a combined export unions columns from several sources, so the
 * first row rarely carries all of them.
 */
export function downloadCsv(
  rows: Record<string, unknown>[],
  headers: string[],
  filename: string,
) {
  if (rows.length === 0) return;
  const escapeCell = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const escaped = String(value).replace(/"/g, '""');
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  };
  const csv = [
    headers.map(escapeCell).join(","),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default exportExperimentsToCsv;
