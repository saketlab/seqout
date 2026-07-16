import { parsePostgresTextArray } from "@/utils/project";
import { buildCurlCommand } from "@/utils/downloadScript";

// No size: GEO's supplementary_data entries only ever carry the URL (#text)
// and a type (@type) — there is no size to read, in any series or sample.
export type SupplementaryDataRecord = {
  url: string;
  "@type": string | null;
  path: string | null;
};

export type SupplementaryDataItem = {
  id: string;
  url: string;
  fileName: string;
  curlCommand: string;
  browserDownloadUrl: string;
  downloadUrl: string;
  sourceSampleAccession?: string | null;
};

const SUPPLEMENTARY_PLACEHOLDER_VALUES = new Set([
  "NONE",
  "NULL",
  "N/A",
  "NA",
  "-",
  "",
]);

const isValidSupplementaryUrl = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (SUPPLEMENTARY_PLACEHOLDER_VALUES.has(trimmed.toUpperCase())) {
    return false;
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
};

const normalizeSupplementaryRecord = (
  value: unknown,
): SupplementaryDataRecord | null => {
  if (!value) return null;

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const textValue =
      typeof record["#text"] === "string" ? record["#text"] : null;
    const urlValue = typeof record.url === "string" ? record.url : null;
    const resolvedUrl = textValue ?? urlValue;
    if (
      typeof resolvedUrl !== "string" ||
      !isValidSupplementaryUrl(resolvedUrl)
    ) {
      return null;
    }
    const rawType = record["@type"];
    const rawPath = record.path;
    return {
      url: resolvedUrl.trim(),
      "@type":
        typeof rawType === "string" && rawType.trim() ? rawType.trim() : null,
      path:
        typeof rawPath === "string" && rawPath.trim() ? rawPath.trim() : null,
    };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (isValidSupplementaryUrl(trimmed)) {
      return { url: trimmed, "@type": null, path: null };
    }

    try {
      return normalizeSupplementaryRecord(JSON.parse(trimmed) as unknown);
    } catch {
      return null;
    }
  }

  return null;
};

export const parseSupplementaryData = (
  rawValue: unknown,
): SupplementaryDataRecord[] => {
  if (!rawValue) {
    return [];
  }

  if (Array.isArray(rawValue)) {
    return rawValue
      .map((entry) => normalizeSupplementaryRecord(entry))
      .filter((entry): entry is SupplementaryDataRecord => entry !== null);
  }

  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => normalizeSupplementaryRecord(entry))
          .filter((entry): entry is SupplementaryDataRecord => entry !== null);
      }
      const normalized = normalizeSupplementaryRecord(parsed);
      return normalized ? [normalized] : [];
    } catch {
      const postgresArrayItems = parsePostgresTextArray(trimmed);
      if (postgresArrayItems.length > 0) {
        return postgresArrayItems
          .map((entry) => normalizeSupplementaryRecord(entry))
          .filter((entry): entry is SupplementaryDataRecord => entry !== null);
      }
      const normalized = normalizeSupplementaryRecord(trimmed);
      return normalized ? [normalized] : [];
    }
  }

  const normalized = normalizeSupplementaryRecord(rawValue);
  return normalized ? [normalized] : [];
};

export const getFileNameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const fileName = parsed.pathname.split("/").filter(Boolean).pop();
    return fileName ?? "supplementary_file";
  } catch {
    const fileName = url.split("/").filter(Boolean).pop();
    return fileName ?? "supplementary_file";
  }
};

export const getBrowserDownloadUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "ftp:") {
      parsed.protocol = "https:";
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
};

export const getAppDownloadUrl = (url: string, fileName: string): string =>
  `/web-api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(fileName)}`;

export const buildSupplementaryItems = ({
  rawValue,
  idPrefix,
  sourceSampleAccession = null,
}: {
  rawValue: unknown;
  idPrefix: string;
  sourceSampleAccession?: string | null;
}): SupplementaryDataItem[] =>
  parseSupplementaryData(rawValue)
    .map((entry, index): SupplementaryDataItem | null => {
      const url = entry.url?.trim();
      if (!url) {
        return null;
      }
      const browserDownloadUrl = getBrowserDownloadUrl(url);
      const fileName = entry.path?.trim() || getFileNameFromUrl(url);
      return {
        id: `${idPrefix}-${index}`,
        url: browserDownloadUrl,
        fileName,
        curlCommand: buildCurlCommand(browserDownloadUrl),
        browserDownloadUrl,
        downloadUrl: getAppDownloadUrl(browserDownloadUrl, fileName),
        sourceSampleAccession,
      };
    })
    .filter((entry): entry is SupplementaryDataItem => entry !== null);
