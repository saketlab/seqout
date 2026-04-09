"use client";
import { useToast } from "@/components/toast-provider";
import { copyToClipboard } from "@/utils/clipboard";
import { Link2Icon } from "@radix-ui/react-icons";
import { useState } from "react";

export default function SectionAnchor({ id }: { id: string }) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleClick = async () => {
    const url = new URL(window.location.href);
    url.hash = id;
    const sectionUrl = url.toString();

    let didCopy = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(sectionUrl);
        didCopy = true;
      } catch {
        didCopy = false;
      }
    }

    if (!didCopy) {
      didCopy = copyToClipboard(sectionUrl);
    }

    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${id}`);
    setCopied(didCopy);
    window.setTimeout(() => setCopied(false), 1500);
    if (didCopy) showToast("Link to section copied");
  };

  return (
    <button
      type="button"
      aria-label={`Copy link to #${id}`}
      title={copied ? "Copied section link" : `Copy link to ${id}`}
      onClick={() => {
        void handleClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: "none",
        background: "transparent",
        cursor: "pointer",
        // 8px padding + 16px icon = 32×32 hit area, clears WCAG 2.2
        // § 2.5.8 (Target Size Minimum, 24×24 AA). Negative margin keeps
        // the visual footprint tight next to heading text.
        padding: "8px",
        margin: "-8px -4px -8px 0",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "32px",
        minHeight: "32px",
        color: copied ? "var(--accent-11)" : "var(--gray-12)",
        opacity: copied ? 1 : hovered ? 1 : 0.35,
        transition: "opacity 150ms, color 150ms",
      }}
    >
      <Link2Icon />
    </button>
  );
}
