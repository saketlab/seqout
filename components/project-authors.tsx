"use client";

import * as React from "react";
import Link from "next/link";
import { Text } from "@radix-ui/themes";
import { authorHref } from "@/utils/project";

type ProjectAuthorsProps = {
  authors: string[];
  // Render nothing when the author list is just the center/org name.
  centerName?: string | null;
  initialVisible?: number;
  size?: React.ComponentProps<typeof Text>["size"];
};

// Author names as links to their projects page, with a reveal toggle when long.
export default function ProjectAuthors({
  authors,
  centerName,
  initialVisible = 8,
  size,
}: ProjectAuthorsProps) {
  const [expanded, setExpanded] = React.useState(false);

  const names = React.useMemo(
    () => authors.map((a) => a.trim()).filter(Boolean),
    [authors],
  );

  if (names.length === 0) return null;
  if (centerName && names.join(", ") === centerName) return null;

  const shown = expanded ? names : names.slice(0, initialVisible);
  const hiddenCount = names.length - shown.length;

  return (
    <Text color="gray" size={size} style={{ minWidth: 0 }}>
      {shown.map((name, i) => (
        <React.Fragment key={`${name}:${i}`}>
          {i > 0 && ", "}
          <Link
            href={authorHref(name)}
            style={{ color: "inherit", textDecoration: "underline" }}
          >
            {name}
          </Link>
        </React.Fragment>
      ))}
      {hiddenCount > 0 && (
        <>
          {", "}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--accent-11)",
              font: "inherit",
            }}
          >
            + {hiddenCount} more
          </button>
        </>
      )}
    </Text>
  );
}
