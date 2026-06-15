"use client";

import { useToast } from "@/components/toast-provider";
import { MAP_ATTRIBUTION_COLOR } from "@/utils/chart-theme";
import { CheckIcon, CopyIcon, DownloadIcon } from "@radix-ui/react-icons";
import { Flex, Popover, Separator, Text, Tooltip } from "@radix-ui/themes";
import { useCallback, useRef, useState } from "react";

export const FOOTER_TEXT = "Source: seqout.org  ·  CC-BY seqout.org";
const FOOTER_CLASS = "seqout-chart-footer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function injectFooterText(chartContext: any) {
  const svg = chartContext.el?.querySelector("svg");
  if (!svg) return;

  svg.querySelectorAll(`.${FOOTER_CLASS}`).forEach((el: Element) => el.remove());

  const svgW = svg.getAttribute("width") || svg.getBoundingClientRect().width;
  const svgH = svg.getAttribute("height") || svg.getBoundingClientRect().height;

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.classList.add(FOOTER_CLASS);
  text.setAttribute("x", String(Number(svgW) - 12));
  text.setAttribute("y", String(Number(svgH) - 6));
  text.setAttribute("text-anchor", "end");
  text.setAttribute("font-size", "11");
  text.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
  text.setAttribute("fill", MAP_ATTRIBUTION_COLOR);
  text.textContent = FOOTER_TEXT;
  svg.appendChild(text);
}

export const chartFooterEvents = {
  mounted: injectFooterText,
  updated: injectFooterText,
};

const popoverButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  border: "none",
  background: "transparent",
  color: "var(--gray-12)",
  fontSize: "var(--font-size-2)",
  cursor: "pointer",
  textAlign: "left",
};

const copyButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  // 6px vertical padding + 13px icon = 25px tall, clears WCAG 2.5.8 (24×24)
  padding: "6px 12px",
  minHeight: "24px",
  borderRadius: "var(--radius-2)",
  border: "1px solid var(--gray-a7)",
  background: "var(--gray-a3)",
  color: "var(--gray-11)",
  fontSize: "var(--font-size-1)",
  fontWeight: 500,
  cursor: "pointer",
  lineHeight: 1,
};

const downloadButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  padding: "6px 12px",
  minHeight: "24px",
  borderRadius: "var(--radius-2)",
  border: "1px solid var(--accent-a7)",
  background: "var(--accent-a3)",
  color: "var(--accent-11)",
  fontSize: "var(--font-size-1)",
  fontWeight: 500,
  cursor: "pointer",
  lineHeight: 1,
};

interface ExportFooterProps {
  onCopy: () => Promise<void>;
  onDownload: (format: string) => void;
  downloadFormats?: string[];
  downloadLabel?: string;
}

export function ExportFooter({
  onCopy,
  onDownload,
  downloadFormats,
  downloadLabel,
}: ExportFooterProps) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await onCopy();
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
      showToast("Chart copied to clipboard");
    } catch (e) {
      console.error("Copy failed:", e);
    }
  }, [onCopy, showToast]);

  const hasMultipleFormats = downloadFormats && downloadFormats.length > 1;

  return (
    <>
      <Separator size="4" mt="3" />
      <Flex
        justify="between"
        align="center"
        pt="2"
        px="1"
        gap="3"
        wrap="wrap"
      >
        <Text size="1" style={{ color: "var(--gray-11)", lineHeight: 1.4 }}>
          Source:{" "}
          <a
            href="https://seqout.org"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit", textDecoration: "underline" }}
          >
            seqout.org
          </a>
        </Text>

        <Flex align="center" gap="3">
          <Text size="1" style={{ color: "var(--gray-11)" }}>
            CC-BY seqout.org
          </Text>
          <Tooltip content={copied ? "Copied!" : "Copy chart to clipboard"}>
            <button type="button" onClick={handleCopy} style={copyButtonStyle}>
              {copied ? (
                <CheckIcon width="13" height="13" />
              ) : (
                <CopyIcon width="13" height="13" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </Tooltip>
          {hasMultipleFormats ? (
            <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
              <Popover.Trigger>
                <button type="button" style={downloadButtonStyle}>
                  <DownloadIcon width="13" height="13" />
                  {downloadLabel ?? "Download"}
                </button>
              </Popover.Trigger>
              <Popover.Content
                side="top"
                align="end"
                sideOffset={4}
                style={{ padding: 0, minWidth: 120 }}
              >
                <Flex direction="column">
                  {downloadFormats.map((fmt, i) => (
                    <div key={fmt}>
                      {i > 0 && <Separator size="4" />}
                      <button
                        type="button"
                        onClick={() => {
                          setPopoverOpen(false);
                          onDownload(fmt);
                        }}
                        style={popoverButtonStyle}
                      >
                        {fmt.toUpperCase()}
                      </button>
                    </div>
                  ))}
                </Flex>
              </Popover.Content>
            </Popover.Root>
          ) : (
            <Tooltip
              content={`Download as ${downloadLabel ?? downloadFormats?.[0]?.toUpperCase() ?? "PNG"}`}
            >
              <button
                type="button"
                onClick={() =>
                  onDownload(downloadFormats?.[0] ?? "png")
                }
                style={downloadButtonStyle}
              >
                <DownloadIcon width="13" height="13" />
                {downloadLabel ??
                  `Download ${downloadFormats?.[0]?.toUpperCase() ?? "PNG"}`}
              </button>
            </Tooltip>
          )}
        </Flex>
      </Flex>
    </>
  );
}

interface ChartFooterProps {
  chartId: string;
}

export async function copyBlobToClipboard(blob: Blob) {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error(
      "Clipboard API not available. Copy requires HTTPS or localhost.",
    );
  }
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type]: blob }),
  ]);
}

export default function ChartFooter({ chartId }: ChartFooterProps) {
  const copyToClipboard = useCallback(async () => {
    const ApexCharts = (await import("apexcharts")).default;
    const { imgURI } = (await ApexCharts.exec(chartId, "dataURI", {
      scale: 3,
    })) as { imgURI: string };
    const res = await fetch(imgURI);
    const blob = await res.blob();
    await copyBlobToClipboard(blob);
  }, [chartId]);

  const download = useCallback(
    async (format: string) => {
      const ApexCharts = (await import("apexcharts")).default;
      if (format === "png") {
        ApexCharts.exec(chartId, "dataURI", { scale: 3 }).then(
          ({ imgURI }: { imgURI: string }) => {
            const a = document.createElement("a");
            a.href = imgURI;
            a.download = `${chartId}.png`;
            a.click();
          },
        );
      } else {
        ApexCharts.exec(chartId, "exportToSVG");
      }
    },
    [chartId],
  );

  return (
    <ExportFooter
      onCopy={copyToClipboard}
      onDownload={download}
      downloadFormats={["png", "svg"]}
    />
  );
}
