"use client";

import SectionAnchor from "@/components/section-anchor";
import { useToast } from "@/components/toast-provider";
import { ensureAgGridModules } from "@/lib/ag-grid";
import { copyToClipboard } from "@/utils/clipboard";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
} from "@radix-ui/react-icons";
import {
  Badge,
  Button,
  Dialog,
  Flex,
  Link,
  Spinner,
  Text,
} from "@radix-ui/themes";
import type {
  ColDef,
  GridApi,
  ICellRendererParams,
  ValueGetterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import React, { useState } from "react";

ensureAgGridModules();

type SupplementaryDataRecord = {
  url: string;
  "@type": string | null;
  path: string | null;
  size: number | null;
};

type SupplementaryDataItem = {
  id: string;
  url: string;
  fileName: string;
  fileSizeBytes: number | null;
  fileSizeLabel: string | null;
  curlCommand: string;
  browserDownloadUrl: string;
  downloadUrl: string;
};

const parsePostgresTextArray = (value: string): string[] => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return [];
  const content = trimmed.slice(1, -1);
  if (!content) return [];

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
      if (inQuotes) escaped = true;
      else current += char;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      if (current.trim()) items.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) items.push(current.trim());
  return items;
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
    if (typeof resolvedUrl !== "string" || resolvedUrl.trim().length === 0) {
      return null;
    }
    const rawType = record["@type"];
    const rawPath = record.path;
    const rawSize = record.size;
    return {
      url: resolvedUrl.trim(),
      "@type":
        typeof rawType === "string" && rawType.trim() ? rawType.trim() : null,
      path:
        typeof rawPath === "string" && rawPath.trim() ? rawPath.trim() : null,
      size:
        typeof rawSize === "number" && Number.isFinite(rawSize)
          ? rawSize
          : null,
    };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("ftp://")
    ) {
      return { url: trimmed, "@type": null, path: null, size: null };
    }
    try {
      return normalizeSupplementaryRecord(JSON.parse(trimmed) as unknown);
    } catch {
      return null;
    }
  }

  return null;
};

const parseSupplementaryData = (
  rawValue: unknown,
): SupplementaryDataRecord[] => {
  if (!rawValue) return [];

  if (Array.isArray(rawValue)) {
    return rawValue
      .map((entry) => normalizeSupplementaryRecord(entry))
      .filter((entry): entry is SupplementaryDataRecord => entry !== null);
  }

  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) return [];
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

const shellEscapeSingleQuotes = (value: string): string =>
  `'${value.replace(/'/g, `'\"'\"'`)}'`;

const getFileNameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const fileName = parsed.pathname.split("/").filter(Boolean).pop();
    return fileName ?? "supplementary_file";
  } catch {
    const fileName = url.split("/").filter(Boolean).pop();
    return fileName ?? "supplementary_file";
  }
};

const getBrowserDownloadUrl = (url: string): string => {
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

const getAppDownloadUrl = (url: string, fileName: string): string =>
  `/web-api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(fileName)}`;

const INLINE_PREVIEW_EXTENSIONS = new Set([
  ".txt",
  ".tsv",
  ".csv",
  ".json",
  ".xml",
  ".html",
  ".htm",
  ".md",
  ".yaml",
  ".yml",
  ".log",
]);

const shouldUseProxyDownload = (url: string, fileName: string): boolean => {
  const normalizedName = fileName.toLowerCase();
  const nameMatch = normalizedName.match(/(\.[a-z0-9]+)$/);
  if (nameMatch) return INLINE_PREVIEW_EXTENSIONS.has(nameMatch[1]);

  const normalizedUrl = url.toLowerCase().split("?")[0].split("#")[0];
  const urlMatch = normalizedUrl.match(/(\.[a-z0-9]+)$/);
  return urlMatch ? INLINE_PREVIEW_EXTENSIONS.has(urlMatch[1]) : false;
};

const buildCurlCommand = (url: string): string =>
  `curl -O ${shellEscapeSingleQuotes(url)}`;

const buildSupplementaryDownloadScript = (
  items: { browserDownloadUrl: string }[],
): string => {
  if (items.length === 0) return "";
  return `curl -L ${items
    .map((item) => `-O ${shellEscapeSingleQuotes(item.browserDownloadUrl)}`)
    .join(" ")}`;
};

const formatFileSize = (sizeInBytes: number | null): string | null => {
  if (sizeInBytes === null || !Number.isFinite(sizeInBytes) || sizeInBytes < 0) {
    return null;
  }
  if (sizeInBytes < 1024) return `${sizeInBytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = sizeInBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
};

export function SupplementaryDataSection({
  accession,
  rawSupplementaryData,
  agGridThemeClassName,
  title = "Supplementary Data",
}: {
  accession: string;
  rawSupplementaryData: unknown;
  agGridThemeClassName: string;
  title?: string;
}) {
  const { showToast } = useToast();
  const [isDownloadingAllSupplementary, setIsDownloadingAllSupplementary] =
    useState(false);
  const [downloadAllProgressPercent, setDownloadAllProgressPercent] = useState<
    number | null
  >(null);
  const supplementaryGridRef =
    React.useRef<GridApi<SupplementaryDataItem> | null>(null);
  const [selectedSupplementaryCount, setSelectedSupplementaryCount] =
    useState(0);
  const [supplementaryScriptDialogOpen, setSupplementaryScriptDialogOpen] =
    useState(false);
  const [supplementaryScriptPreview, setSupplementaryScriptPreview] =
    useState("");
  const [supplementaryScriptCopied, setSupplementaryScriptCopied] =
    useState(false);

  const supplementaryDataItems = React.useMemo(() => {
    return parseSupplementaryData(rawSupplementaryData)
      .map((entry, index): SupplementaryDataItem | null => {
        const url = entry.url?.trim();
        if (!url) return null;
        const browserDownloadUrl = getBrowserDownloadUrl(url);
        const fileName = entry.path?.trim() || getFileNameFromUrl(url);
        return {
          id: `${accession}-supplementary-${index}`,
          url: browserDownloadUrl,
          fileName,
          fileSizeBytes: entry.size,
          fileSizeLabel: formatFileSize(entry.size),
          curlCommand: buildCurlCommand(browserDownloadUrl),
          browserDownloadUrl,
          downloadUrl: shouldUseProxyDownload(browserDownloadUrl, fileName)
            ? getAppDownloadUrl(browserDownloadUrl, fileName)
            : browserDownloadUrl,
        };
      })
      .filter((entry): entry is SupplementaryDataItem => entry !== null);
  }, [accession, rawSupplementaryData]);

  const cliDownloadCommand = `curl -sS "https://seqout.org/api/project/${accession}/supplementary/download" | bash`;

  const allSupplementarySizeLabel = React.useMemo(() => {
    if (supplementaryDataItems.length === 0) return null;
    const missingSize = supplementaryDataItems.some(
      (item) => item.fileSizeBytes === null,
    );
    if (missingSize) return null;
    const totalSize = supplementaryDataItems.reduce(
      (sum, item) => sum + (item.fileSizeBytes ?? 0),
      0,
    );
    return formatFileSize(totalSize);
  }, [supplementaryDataItems]);

  const supplementaryColDefs = React.useMemo<
    ColDef<SupplementaryDataItem>[]
  >(
    () => [
      {
        headerName: "File",
        field: "fileName",
        flex: 1,
        minWidth: 260,
        cellRenderer: (
          params: ICellRendererParams<SupplementaryDataItem>,
        ) => {
          const row = params.data;
          if (!row) return "-";
          return (
            <Link
              href={row.browserDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              size="1"
              style={{ fontFamily: "var(--code-font-family)" }}
            >
              {row.fileName}
            </Link>
          );
        },
      },
      {
        headerName: "Size",
        field: "fileSizeBytes",
        minWidth: 100,
        maxWidth: 140,
        valueGetter: (params: ValueGetterParams<SupplementaryDataItem>) =>
          params.data?.fileSizeBytes ?? 0,
        valueFormatter: (params) =>
          typeof params.value === "number" && params.value > 0
            ? (formatFileSize(params.value as number) ?? "-")
            : "-",
      },
    ],
    [],
  );

  const supplementaryDefaultColDef = React.useMemo<
    ColDef<SupplementaryDataItem>
  >(() => ({ filter: true, resizable: true, sortable: true }), []);

  const handleDownloadAllSupplementaryFiles = async (
    items: SupplementaryDataItem[],
  ) => {
    if (items.length === 0) return;
    try {
      setIsDownloadingAllSupplementary(true);
      setDownloadAllProgressPercent(0);
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const link = document.createElement("a");
        link.href = item.downloadUrl;
        link.download = item.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setDownloadAllProgressPercent(
          Math.round(((index + 1) / items.length) * 100),
        );
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
    } catch (error) {
      console.error("Failed to download all supplementary files:", error);
    } finally {
      setIsDownloadingAllSupplementary(false);
      window.setTimeout(() => setDownloadAllProgressPercent(null), 300);
    }
  };

  const handleSupplementaryGridReady = React.useCallback(
    (params: { api: GridApi<SupplementaryDataItem> }) => {
      supplementaryGridRef.current = params.api;
    },
    [],
  );

  const getSupplementaryDownloadItems = (
    allItems: SupplementaryDataItem[],
  ): SupplementaryDataItem[] => {
    const selected = supplementaryGridRef.current?.getSelectedRows() ?? [];
    return selected.length > 0 ? selected : allItems;
  };

  const computeSupplementaryScriptText = (
    items: SupplementaryDataItem[],
  ): string => {
    if (items.length === 0) return "";
    return items.length === supplementaryDataItems.length
      ? cliDownloadCommand
      : buildSupplementaryDownloadScript(items);
  };

  const handleSupplementarySelectionChanged = () => {
    const selected = supplementaryGridRef.current?.getSelectedRows() ?? [];
    setSelectedSupplementaryCount(selected.length);
    if (supplementaryScriptDialogOpen) {
      const rows = selected.length > 0 ? selected : supplementaryDataItems;
      setSupplementaryScriptPreview(computeSupplementaryScriptText(rows));
    }
  };

  const handleCopySupplementaryScript = async () => {
    if (!supplementaryScriptPreview) return;
    let didCopy = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(supplementaryScriptPreview);
        didCopy = true;
      } catch {
        didCopy = false;
      }
    }
    if (!didCopy) didCopy = copyToClipboard(supplementaryScriptPreview);
    setSupplementaryScriptCopied(didCopy);
    window.setTimeout(() => setSupplementaryScriptCopied(false), 1500);
    if (didCopy) showToast("Download script copied");
  };

  const supplementaryDownloadLabel =
    selectedSupplementaryCount > 0
      ? `Download ${selectedSupplementaryCount} selected`
      : "Download all";
  const supplementaryScriptLabel =
    selectedSupplementaryCount > 0
      ? `Copy script (${selectedSupplementaryCount} selected)`
      : "Copy script";

  return (
    <>
      <Flex id="supplementary" align="center" gap="2">
        <Text weight="medium" size="6">
          {title}
        </Text>
        <SectionAnchor id="supplementary" />
      </Flex>
      {supplementaryDataItems.length === 0 && (
        <Text size="2" color="gray">
          No supplementary files found
        </Text>
      )}
      {supplementaryDataItems.length > 0 && (
        <Flex direction="column" gap="2" style={{ width: "100%" }}>
          <Flex gap="3" justify="between" wrap="wrap">
            <Flex gap="2" align="center" wrap="wrap">
              <Badge size="2" color="blue">
                {supplementaryDataItems.length.toLocaleString()} file
                {supplementaryDataItems.length !== 1 ? "s" : ""}
              </Badge>
              {allSupplementarySizeLabel && (
                <Badge size="2" variant="soft">
                  {allSupplementarySizeLabel} total
                </Badge>
              )}
            </Flex>
            <Flex gap="2" wrap="wrap">
              <Button
                size="2"
                variant="surface"
                disabled={isDownloadingAllSupplementary}
                onClick={() => {
                  const items =
                    getSupplementaryDownloadItems(supplementaryDataItems);
                  if (items.length === 0) return;
                  void handleDownloadAllSupplementaryFiles(items);
                }}
              >
                {isDownloadingAllSupplementary ? (
                  <Flex align="center" gap="1">
                    <Spinner size="1" />
                    <Text size="1">
                      {downloadAllProgressPercent !== null
                        ? `${downloadAllProgressPercent}%`
                        : "..."}
                    </Text>
                  </Flex>
                ) : (
                  <>
                    <DownloadIcon /> {supplementaryDownloadLabel}
                  </>
                )}
              </Button>
              <Dialog.Root
                open={supplementaryScriptDialogOpen}
                onOpenChange={(open) => {
                  setSupplementaryScriptDialogOpen(open);
                  if (open) {
                    const items =
                      getSupplementaryDownloadItems(supplementaryDataItems);
                    setSupplementaryScriptPreview(
                      computeSupplementaryScriptText(items),
                    );
                    setSupplementaryScriptCopied(false);
                  }
                }}
              >
                <Dialog.Trigger>
                  <Button size="2" variant="surface">
                    <FileTextIcon /> {supplementaryScriptLabel}
                  </Button>
                </Dialog.Trigger>
                <Dialog.Content size="3">
                  <Flex justify="between" align="center" gap="3" mb="3">
                    <Dialog.Title mb="0">Copy download script</Dialog.Title>
                    <Button
                      size="2"
                      variant="soft"
                      onClick={() => {
                        void handleCopySupplementaryScript();
                      }}
                      disabled={!supplementaryScriptPreview}
                    >
                      {supplementaryScriptCopied ? <CheckIcon /> : <CopyIcon />}
                      {supplementaryScriptCopied ? "Copied!" : "Copy"}
                    </Button>
                  </Flex>
                  <div
                    style={{
                      width: "100%",
                      maxWidth: "100%",
                      overflow: "hidden",
                      background: "var(--gray-3)",
                      border: "1px solid var(--gray-6)",
                      borderRadius: "8px",
                    }}
                  >
                    <pre
                      style={{
                        margin: 0,
                        width: "100%",
                        boxSizing: "border-box",
                        padding: "0.875rem",
                        overflowY: "auto",
                        maxHeight: "24rem",
                        fontSize: "12px",
                        lineHeight: "1.5",
                        fontFamily: "var(--default-mono-font-family)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      <code>
                        {supplementaryScriptPreview ||
                          "# No supplementary files available"}
                      </code>
                    </pre>
                  </div>
                </Dialog.Content>
              </Dialog.Root>
            </Flex>
          </Flex>
          <div
            className={agGridThemeClassName}
            style={{
              width: "100%",
              height: `${Math.min(supplementaryDataItems.length * 42 + 49, 320)}px`,
            }}
          >
            <AgGridReact<SupplementaryDataItem>
              columnDefs={supplementaryColDefs}
              defaultColDef={supplementaryDefaultColDef}
              rowData={supplementaryDataItems}
              getRowId={(params) => params.data.id}
              rowSelection={{
                mode: "multiRow",
                checkboxes: true,
                headerCheckbox: true,
              }}
              onGridReady={handleSupplementaryGridReady}
              onSelectionChanged={handleSupplementarySelectionChanged}
              theme="legacy"
            />
          </div>
        </Flex>
      )}
    </>
  );
}
