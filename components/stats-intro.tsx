"use client";

import { humanize } from "@/utils/format";
import { useSourceTotals } from "@/utils/useStats";
import { Text, Tooltip } from "@radix-ui/themes";

export default function StatsIntro() {
  const { data: totals } = useSourceTotals();

  let projects: number | null = null;
  let samples: number | null = null;
  if (totals) {
    const values = Object.values(totals);
    projects = values.reduce((sum, v) => sum + v.projects, 0);
    samples = values.reduce((sum, v) => sum + v.samples, 0);
  }

  const stat = (n: number | null, fallback: string) =>
    n === null ? (
      fallback
    ) : (
      <Tooltip content={`${n.toLocaleString()} exactly`}>
        <span style={{ cursor: "help" }}>{humanize(n)}+</span>
      </Tooltip>
    );

  return (
    <Text color="gray">
      seqout currently indexes {stat(projects, "2M+")} projects and{" "}
      {stat(samples, "85M+")} samples across SRA, GEO, ArrayExpress, and ENA for
      fast search and discovery.
    </Text>
  );
}
