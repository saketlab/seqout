"use client";

import ChartFooter, { chartFooterEvents } from "@/components/chart-footer";
import SectionAnchor from "@/components/section-anchor";
import { DB_COLORS } from "@/utils/db-colors";
import { humanize } from "@/utils/format";
import { Card, Flex, SegmentedControl, Text } from "@radix-ui/themes";
import type { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

type Metric = "Projects" | "Samples";

const SOURCES = ["SRA", "GEO", "ArrayExpress", "ENA"];

const COUNTS: Record<Metric, number[]> = {
  Projects: [679861, 272122, 80005, 1007427],
  Samples: [39381658, 8183901, 4144991, 35585152],
};

export default function StatsSourceHistogramCard() {
  const [metric, setMetric] = useState<Metric>("Projects");
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const chartOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        id: "seqout-source-dist",
        type: "bar",
        background: isDark ? "#111113" : "#ffffff",
        toolbar: { show: false },
        foreColor: isDark ? "#a1a1aa" : "#71717a",
        events: chartFooterEvents,
      },
      title: {
        text: `Source Distribution — ${metric}`,
        align: "left",
        style: {
          fontSize: "16px",
          fontWeight: "600",
          fontFamily: "system-ui, sans-serif",
          color: isDark ? "#fafafa" : "#000000",
        },
      },
      subtitle: {
        text: `Total ${metric.toLowerCase()} across SRA, GEO, ArrayExpress & ENA`,
        align: "left",
        style: {
          fontSize: "12px",
          fontFamily: "system-ui, sans-serif",
          color: isDark ? "#a1a1aa" : "#555555",
        },
      },
      xaxis: {
        categories: SOURCES,
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
          fontFamily: "system-ui, sans-serif",
          colors: [isDark ? "#e4e4e7" : "#18181b"],
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
      colors: [DB_COLORS.sra, DB_COLORS.geo, DB_COLORS.arrayexpress, DB_COLORS.ena],
      grid: {
        strokeDashArray: 4,
        borderColor: isDark ? "#3f3f46" : "#e4e4e7",
        padding: { bottom: 16 },
      },
      tooltip: {
        theme: isDark ? "dark" : "light",
        y: {
          formatter: (value) => `${value.toLocaleString()} ${metric}`,
        },
      },
    }),
    [metric, isDark],
  );

  const series = useMemo(
    () => [
      {
        name: metric,
        data: COUNTS[metric],
      },
    ],
    [metric],
  );

  return (
    <Card style={{ width: "100%" }}>
      <Flex justify="between" align="center" mb="4" gap="3">
        <Flex align="center" gap="2">
          <Text size="5" weight="bold" ml={"1"}>
            Source distribution
          </Text>
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
    </Card>
  );
}
