"use client";
import { copyToClipboard } from "@/utils/clipboard";
import { Link2Icon } from "@radix-ui/react-icons";
import { useState } from "react";

export default function SectionAnchor({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      aria-label={`Copy link to #${id}`}
      onClick={() => {
        const url = `${window.location.origin}${window.location.pathname}#${id}`;
        copyToClipboard(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: "2px",
        display: "inline-flex",
        alignItems: "center",
        color: copied ? "var(--accent-11)" : "var(--gray-12)",
        opacity: copied ? 1 : hovered ? 1 : 0.35,
        transition: "opacity 150ms, color 150ms",
      }}
    >
      <Link2Icon />
    </button>
  );
}
