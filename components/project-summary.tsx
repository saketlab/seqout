"use client";
import { Link, Text } from "@radix-ui/themes";
import DOMPurify from "dompurify";
import type { ComponentProps } from "react";
import { useMemo, useState } from "react";

const ALLOWED_TAGS = [
  "a",
  "b",
  "i",
  "em",
  "strong",
  "p",
  "br",
  "sup",
  "sub",
  "u",
];

function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return stripTags(html);
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "target", "rel"],
  });
  DOMPurify.removeHook("afterSanitizeAttributes");
  return clean;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

type ProjectSummaryProps = {
  text?: string | null;
  charLimit?: number;
  size?: ComponentProps<typeof Text>["size"];
};

export default function ProjectSummary({
  text,
  charLimit = 350,
  size,
}: ProjectSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  const { plainText, sanitized } = useMemo(() => {
    if (!text) return { plainText: "", sanitized: "" };
    const clean = sanitizeHtml(text);
    return { plainText: stripTags(text), sanitized: clean };
  }, [text]);

  if (!text) return null;

  const shouldTruncate = plainText.length > charLimit;

  return (
    <Text size={size}>
      {expanded || !shouldTruncate ? (
        <span dangerouslySetInnerHTML={{ __html: sanitized }} />
      ) : (
        <>{plainText.slice(0, charLimit)}...</>
      )}
      {shouldTruncate && (
        <Link
          ml="1"
          style={{ cursor: "pointer" }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "less" : "more"}
        </Link>
      )}
    </Text>
  );
}
