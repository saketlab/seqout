"use client";

import ChartFooter, { chartFooterEvents } from "@/components/chart-footer";
import SectionAnchor from "@/components/section-anchor";
import { getApexChartTheme } from "@/utils/chart-theme";
import { DB_COLORS, DB_LABELS } from "@/utils/db-colors";
import { humanize } from "@/utils/format";
import { useSourceTotals } from "@/utils/useStats";
import {
  Flex,
  Heading,
  SegmentedControl,
} from "@radix-ui/themes";
import type { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { useReducedMotion } from "@/utils/useReducedMotion";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

type Metric = "Projects" | "Samples";

const SOURCE_KEYS = ["sra", "geo", "arrayexpress", "ena", "gsa"] as const;

export default function StatsSourceHistogramCard() {
  const [metric, setMetric] = useState<Metric>("Projects");
  const { data: totals } = useSourceTotals();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const reduced = useReducedMotion();

  const chartOptions = useMemo<ApexOptions>(
    () => {
      const theme = getApexChartTheme(isDark);
      return {
      chart: {
        id: "seqout-source-dist",
        type: "bar",
        background: theme.background,
        toolbar: { show: false },
        foreColor: theme.foreColor,
        animations: { enabled: !reduced },
        events: chartFooterEvents,
      },
      title: {
        text: `Source Distribution — ${metric}`,
        align: "left",
        style: {
          fontSize: "16px",
          fontWeight: "600",
          fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
          color: theme.titleColor,
        },
      },
      subtitle: {
        text: `Total ${metric.toLowerCase()} across SRA, GEO, ArrayExpress, ENA & GSA`,
        align: "left",
        style: {
          fontSize: "12px",
          fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
          color: theme.subtitleColor,
        },
      },
      xaxis: {
        categories: SOURCE_KEYS.map((k) => DB_LABELS[k]),
        title: { text: "Source" },
      },
      yaxis: {
        title: { text: metric },
      },
      dataLabels: {
        enabled: true,
        formatter: (value) => humanize(Number(value)),
        offsetY: -20,
        style: {
          fontSize: "12px",
          fontWeight: "600",
          fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
          colors: [theme.dataLabelColor],
        },
      },
      plotOptions: {
        bar: {
          borderRadius: 4,
          columnWidth: "55%",
          distributed: true,
          dataLabels: {
            position: "top",
          },
        },
      },
      legend: { show: false },
      colors: SOURCE_KEYS.map((k) => DB_COLORS[k]),
      grid: {
        strokeDashArray: 4,
        borderColor: theme.gridBorderColor,
        padding: { bottom: 16 },
      },
      tooltip: {
        theme: isDark ? "dark" : "light",
        y: {
          formatter: (value) => `${value.toLocaleString()} ${metric}`,
        },
      },
      };
    },
    [metric, isDark, reduced],
  );

  const series = useMemo(
    () => [
      {
        name: metric,
        data: totals
          ? SOURCE_KEYS.map((k) =>
              metric === "Projects" ? totals[k].projects : totals[k].samples,
            )
          : [],
      },
    ],
    [metric, totals],
  );

  return (
    <Flex
      direction="column"
      width="100%"
      py={{ initial: "4", md: "5" }}
    >
      <Flex justify="between" align="center" mb="4" gap="3">
        <Flex align="center" gap="2">
          <Heading as="h2" size="5" weight="bold" ml={"1"}>
            Source distribution
          </Heading>
          <SectionAnchor id="sources" />
        </Flex>
        <SegmentedControl.Root
          defaultValue={metric}
          value={metric}
          onValueChange={(value) => setMetric(value as Metric)}
        >
          <SegmentedControl.Item value="Projects">
            Projects
          </SegmentedControl.Item>
          <SegmentedControl.Item value="Samples">Samples</SegmentedControl.Item>
        </SegmentedControl.Root>
      </Flex>
      <Chart
        type="bar"
        options={chartOptions}
        series={series}
        height={360}
        width="100%"
      />
      <ChartFooter chartId="seqout-source-dist" />
    </Flex>
  );
}
