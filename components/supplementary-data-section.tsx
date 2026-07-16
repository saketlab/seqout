"use client";

import SectionAnchor from "@/components/section-anchor";
import { useToast } from "@/components/toast-provider";
import { ensureAgGridModules } from "@/lib/ag-grid";
import { copyToClipboard } from "@/utils/clipboard";
import { buildSupplementaryDownloadScript } from "@/utils/downloadScript";
import {
  buildSupplementaryItems,
  type SupplementaryDataItem,
} from "@/utils/supplementary";
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
  Heading,
  Link,
  Spinner,
  Text,
} from "@radix-ui/themes";
import type { ColDef, GridApi, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import React, { useState } from "react";

ensureAgGridModules();

export function SupplementaryDataSection({
  accession,
  rawSupplementaryData,
  agGridThemeClassName,
  title = "Supplementary Data",
  clientScriptOnly = false,
}: {
  accession: string;
  rawSupplementaryData: unknown;
  agGridThemeClassName: string;
  title?: string;
  // Samples have no /project/{acc}/supplementary/download endpoint — build the
  // download-all script from the file URLs instead of pointing at that route.
  clientScriptOnly?: boolean;
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

  const supplementaryDataItems = React.useMemo(
    () =>
      buildSupplementaryItems({
        rawValue: rawSupplementaryData,
        idPrefix: `${accession}-supplementary`,
      }),
    [accession, rawSupplementaryData],
  );

  const cliDownloadCommand = `curl -sS "https://seqout.org/api/project/${accession}/supplementary/download" | bash`;

  const supplementaryColDefs = React.useMemo<ColDef<SupplementaryDataItem>[]>(
    () => [
      {
        headerName: "File",
        field: "fileName",
        flex: 1,
        minWidth: 260,
        cellRenderer: (params: ICellRendererParams<SupplementaryDataItem>) => {
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
      showToast(
        `Downloading ${items.length} file${items.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      console.error("Failed to download supplementary files:", error);
      showToast("Failed to start supplementary downloads");
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
    if (clientScriptOnly) return buildSupplementaryDownloadScript(items);
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
      ? `Download script (${selectedSupplementaryCount} selected)`
      : "Download script";

  if (supplementaryDataItems.length === 0) return null;

  return (
    <>
      <Flex id="supplementary" align="center" gap="2">
        <Heading as="h2" weight="medium" size="6">
          {title}
        </Heading>
        <SectionAnchor id="supplementary" />
      </Flex>
      {supplementaryDataItems.length > 0 && (
        <Flex direction="column" gap="2" style={{ width: "100%" }}>
          <Flex gap="3" justify="between" wrap="wrap">
            <Flex gap="2" align="center" wrap="wrap">
              <Badge size="2" color="blue">
                {supplementaryDataItems.length.toLocaleString()} file
                {supplementaryDataItems.length !== 1 ? "s" : ""}
              </Badge>
            </Flex>
            <Flex gap="2" wrap="wrap">
              <Button
                size="2"
                variant="surface"
                disabled={isDownloadingAllSupplementary}
                onClick={() => {
                  const items = getSupplementaryDownloadItems(
                    supplementaryDataItems,
                  );
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
                    const items = getSupplementaryDownloadItems(
                      supplementaryDataItems,
                    );
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
                    <Dialog.Title mb="0">
                      Script for downloading files
                    </Dialog.Title>
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
              height: `${Math.min(500, 48 + supplementaryDataItems.length * 42)}px`,
            }}
          >
            <AgGridReact<SupplementaryDataItem>
              columnDefs={supplementaryColDefs}
              defaultColDef={supplementaryDefaultColDef}
              enableCellTextSelection
              ensureDomOrder
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
