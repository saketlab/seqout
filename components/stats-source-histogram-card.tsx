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
  Skeleton,
} from "@radix-ui/themes";
import type { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { useReducedMotion } from "@/utils/useReducedMotion";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

type Metric = "Projects" | "Samples";

const SOURCE_KEYS = ["sra", "geo", "arrayexpress", "ena", "gsa", "dra", "gea"] as const;

export default function StatsSourceHistogramCard() {
  const [metric, setMetric] = useState<Metric>("Projects");
  const [logScale, setLogScale] = useState(false);
  const { data: totals, isLoading } = useSourceTotals();
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
        text: `Source distribution: ${metric}`,
        align: "left",
        style: {
          fontSize: "16px",
          fontWeight: "600",
          fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
          color: theme.titleColor,
        },
      },
      subtitle: {
        text: `Total ${metric.toLowerCase()} across SRA, GEO, ArrayExpress, ENA, GSA, DRA & GEA`,
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
        logarithmic: logScale,
        logBase: 10,
        // log(0) is undefined; a bar of 1 renders as an empty bar at the baseline.
        min: logScale ? 1 : 0,
        forceNiceScale: !logScale,
        title: { text: metric },
        labels: { formatter: (value) => humanize(Math.round(value)) },
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
    [metric, isDark, reduced, logScale],
  );

  const series = useMemo(
    () => [
      {
        name: metric,
        data: SOURCE_KEYS.map((k) =>
          metric === "Projects"
            ? (totals?.[k]?.projects ?? 0)
            : (totals?.[k]?.samples ?? 0),
        ),
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
        <Flex gap="3" align="center" wrap="wrap">
          <SegmentedControl.Root
            value={logScale ? "log" : "linear"}
            onValueChange={(value) => setLogScale(value === "log")}
            size="1"
          >
            <SegmentedControl.Item value="linear">Linear</SegmentedControl.Item>
            <SegmentedControl.Item value="log">Log</SegmentedControl.Item>
          </SegmentedControl.Root>
          <SegmentedControl.Root
            value={metric}
            onValueChange={(value) => setMetric(value as Metric)}
            size="1"
          >
            <SegmentedControl.Item value="Projects">
              Projects
            </SegmentedControl.Item>
            <SegmentedControl.Item value="Samples">
              Samples
            </SegmentedControl.Item>
          </SegmentedControl.Root>
        </Flex>
      </Flex>
      {isLoading || !totals ? (
        <Flex direction="column" gap="3" justify="end" style={{ height: 360 }}>
          <Skeleton width="100%" height="300px" />
        </Flex>
      ) : (
        <>
          <Chart
            type="bar"
            options={chartOptions}
            series={series}
            height={360}
            width="100%"
          />
          <ChartFooter chartId="seqout-source-dist" />
        </>
      )}
    </Flex>
  );
}
