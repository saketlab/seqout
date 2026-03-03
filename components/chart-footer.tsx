"use client";

import { CheckIcon, CopyIcon, DownloadIcon } from "@radix-ui/react-icons";
import { Flex, Popover, Separator, Text, Tooltip } from "@radix-ui/themes";
import { useCallback, useRef, useState } from "react";

const FOOTER_TEXT = "Source: seqout.org  ·  CC-BY seqout.org team";
const FOOTER_CLASS = "seqout-chart-footer";

function injectFooterText(chartContext: { el?: HTMLElement }) {
  const svg = chartContext.el?.querySelector("svg");
  if (!svg) return;

  svg.querySelectorAll(`.${FOOTER_CLASS}`).forEach((el) => el.remove());

  const svgW = svg.getAttribute("width") || svg.getBoundingClientRect().width;
  const svgH = svg.getAttribute("height") || svg.getBoundingClientRect().height;

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.classList.add(FOOTER_CLASS);
  text.setAttribute("x", String(Number(svgW) - 12));
  text.setAttribute("y", String(Number(svgH) - 6));
  text.setAttribute("text-anchor", "end");
  text.setAttribute("font-size", "11");
  text.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
  text.setAttribute("fill", "#999999");
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

interface ChartFooterProps {
  chartId: string;
}

export default function ChartFooter({ chartId }: ChartFooterProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const download = useCallback(
    async (format: "png" | "svg") => {
      setOpen(false);
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

  const copyToClipboard = useCallback(async () => {
    const ApexCharts = (await import("apexcharts")).default;
    const { imgURI } = (await ApexCharts.exec(chartId, "dataURI", {
      scale: 3,
    })) as { imgURI: string };
    const res = await fetch(imgURI);
    const blob = await res.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }, [chartId]);

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
        <Text size="1" style={{ color: "var(--gray-9)", lineHeight: 1.4 }}>
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
          <Text size="1" style={{ color: "var(--gray-9)" }}>
            CC-BY seqout.org team
          </Text>
          <Tooltip content={copied ? "Copied!" : "Copy chart to clipboard"}>
            <button
              type="button"
              onClick={copyToClipboard}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 10px",
                borderRadius: "var(--radius-2)",
                border: "1px solid var(--gray-a7)",
                background: "var(--gray-a3)",
                color: "var(--gray-11)",
                fontSize: "var(--font-size-1)",
                fontWeight: 500,
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              {copied ? (
                <CheckIcon width="13" height="13" />
              ) : (
                <CopyIcon width="13" height="13" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </Tooltip>
          <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger>
              <button
                type="button"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 10px",
                  borderRadius: "var(--radius-2)",
                  border: "1px solid var(--accent-a7)",
                  background: "var(--accent-a3)",
                  color: "var(--accent-11)",
                  fontSize: "var(--font-size-1)",
                  fontWeight: 500,
                  cursor: "pointer",
                  lineHeight: 1,
                }}
              >
                <DownloadIcon width="13" height="13" />
                Download
              </button>
            </Popover.Trigger>
            <Popover.Content
              side="top"
              align="end"
              sideOffset={4}
              style={{ padding: 0, minWidth: 120 }}
            >
              <Flex direction="column">
                <button
                  type="button"
                  onClick={() => download("png")}
                  style={popoverButtonStyle}
                >
                  PNG
                </button>
                <Separator size="4" />
                <button
                  type="button"
                  onClick={() => download("svg")}
                  style={popoverButtonStyle}
                >
                  SVG
                </button>
              </Flex>
            </Popover.Content>
          </Popover.Root>
        </Flex>
      </Flex>
    </>
  );
}
