"use client";

import { DB_COLORS } from "@/utils/db-colors";
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

function humanizeCount(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return `${value}`;
}

export default function StatsSourceHistogramCard() {
  const [metric, setMetric] = useState<Metric>("Projects");
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const chartOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: "bar",
        toolbar: { show: false },
        foreColor: isDark ? "#a1a1aa" : "#71717a",
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
        formatter: (value) => humanizeCount(Number(value)),
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
        <Text size="5" weight="bold" ml={"1"}>
          Source distribution
        </Text>
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
    </Card>
  );
}
