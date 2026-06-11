"use client";
import { useToast } from "@/components/toast-provider";
import { copySectionLink } from "@/utils/shareSectionLink";
import { Link2Icon } from "@radix-ui/react-icons";
import { useState } from "react";

export default function SectionAnchor({ id }: { id: string }) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleClick = async () => {
    const didCopy = await copySectionLink(id);
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
        // 32×32 hit area for WCAG 2.5.8; negative margin hides the padding visually.
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
