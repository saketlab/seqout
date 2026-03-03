"use client";

import { SERVER_URL } from "@/utils/constants";
import { DB_COLORS } from "@/utils/db-colors";
import { Card, Flex, SegmentedControl, Skeleton, Text } from "@radix-ui/themes";
import type { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

type Mode = "projects" | "experiments" | "bases";
type View = "cumulative" | "monthly";

interface GrowthPoint {
  month: string;
  count: number;
}

interface GrowthResponse {
  mode: string;
  series: Record<string, GrowthPoint[]>;
  took_ms: number;
}

const DB_LABELS: Record<string, string> = {
  geo: "GEO",
  sra: "SRA",
  arrayexpress: "ArrayExpress",
  ena: "ENA",
  sra_fastq_bytes: "SRA (FASTQ)",
  sra_sra_bytes: "SRA (SRA archive)",
};


const DB_ORDER: Record<Mode, string[]> = {
  projects: ["geo", "sra", "arrayexpress", "ena"],
  experiments: ["geo", "sra", "arrayexpress", "ena"],
  bases: ["ena", "sra_fastq_bytes", "sra_sra_bytes"],
};

async function fetchGrowth(mode: Mode): Promise<GrowthResponse> {
  const res = await fetch(`${SERVER_URL}/stats/growth?mode=${mode}`);
  if (!res.ok) throw new Error(`Failed to fetch growth data`);
  return res.json();
}

function buildCumulative(points: GrowthPoint[]): GrowthPoint[] {
  let total = 0;
  return points.map((p) => {
    total += p.count;
    return { month: p.month, count: total };
  });
}

export default function StatsGrowthChartCard() {
  const [mode, setMode] = useState<Mode>("bases");
  const [view, setView] = useState<View>("cumulative");
  const [logScale, setLogScale] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const { data, isLoading } = useQuery({
    queryKey: ["growth", mode],
    queryFn: () => fetchGrowth(mode),
    staleTime: Infinity,
  });

  const chartSeries = useMemo(() => {
    if (!data?.series) return [];
    const order = DB_ORDER[mode];
    return order.filter((db) => db in data.series).map((db) => {
      const raw = data.series[db];
      const points = view === "cumulative" ? buildCumulative(raw) : raw;
      return {
        name: DB_LABELS[db] ?? db,
        data: points.map((p) => ({
          x: new Date(p.month + "-01").getTime(),
          y: p.count,
        })),
        color: DB_COLORS[db],
      };
    });
  }, [data, view, mode]);

  // Build Jan + Jul tick positions from data range
  const xaxisTicks = useMemo(() => {
    if (!data?.series) return undefined;
    let minYear = 9999;
    let maxYear = 0;
    for (const pts of Object.values(data.series)) {
      for (const p of pts as GrowthPoint[]) {
        const y = parseInt(p.month.slice(0, 4), 10);
        if (y < minYear) minYear = y;
        if (y > maxYear) maxYear = y;
      }
    }
    const ticks: number[] = [];
    for (let y = minYear; y <= maxYear; y++) {
      ticks.push(new Date(y, 0, 1).getTime()); // Jan
    }
    return ticks;
  }, [data]);

  const chartOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: view === "cumulative" ? "area" : "line",
        toolbar: {
          show: true,
          tools: {
            download: false,
            selection: true,
            zoom: true,
            zoomin: true,
            zoomout: true,
            pan: true,
            reset: true,
          },
        },
        foreColor: isDark ? "#a1a1aa" : "#71717a",
        zoom: { enabled: true },
        animations: { enabled: false },
      },
      stroke: {
        curve: "smooth",
        width: view === "cumulative" ? 2 : 1.5,
      },
      fill: {
        type: view === "cumulative" ? "gradient" : "solid",
        gradient: {
          opacityFrom: 0.25,
          opacityTo: 0.02,
        },
      },
      xaxis: {
        type: "datetime",
        tickAmount: xaxisTicks?.length,
        labels: {
          datetimeUTC: false,
          formatter: (_value, timestamp) => {
            if (timestamp == null) return "";
            const d = new Date(timestamp);
            const mo = d.getMonth(); // 0=Jan, 6=Jul
            const yr = d.getFullYear();
            return `Jan ${yr}`;
          },
          rotate: -45,
          rotateAlways: false,
          hideOverlappingLabels: true,
        },
      },
      yaxis: {
        logarithmic: logScale,
        labels: {
          formatter: (value) =>
            mode === "bases"
              ? humanizeBytes(Math.round(value))
              : humanize(Math.round(value)),
        },
        title: {
          text:
            mode === "projects"
              ? "Projects"
              : mode === "experiments"
                ? "Experiments"
                : "Bases / Bytes",
        },
      },
      dataLabels: { enabled: false },
      legend: {
        position: "top",
        horizontalAlign: "left",
        fontSize: "13px",
        fontFamily: "system-ui, sans-serif",
        labels: { colors: isDark ? "#d4d4d8" : "#3f3f46" },
      },
      grid: {
        strokeDashArray: 4,
        borderColor: isDark ? "#3f3f46" : "#e4e4e7",
      },
      tooltip: {
        theme: isDark ? "dark" : "light",
        x: { format: "MMM yyyy" },
        y: {
          formatter: (value) =>
            mode === "bases"
              ? humanizeBytes(value)
              : value.toLocaleString(),
        },
      },
    }),
    [mode, view, logScale, isDark],
  );

  return (
    <Card style={{ width: "100%" }}>
      <Flex justify="between" align="center" mb="4" gap="3" wrap="wrap">
        <Text size="5" weight="bold" ml="1">
          Database growth
        </Text>
        <Flex gap="3" align="center" wrap="wrap">
          <SegmentedControl.Root
            value={logScale ? "log" : "linear"}
            onValueChange={(v) => setLogScale(v === "log")}
            size="1"
          >
            <SegmentedControl.Item value="linear">
              Linear
            </SegmentedControl.Item>
            <SegmentedControl.Item value="log">
              Log
            </SegmentedControl.Item>
          </SegmentedControl.Root>
          <SegmentedControl.Root
            value={view}
            onValueChange={(v) => setView(v as View)}
            size="1"
          >
            <SegmentedControl.Item value="cumulative">
              Cumulative
            </SegmentedControl.Item>
            <SegmentedControl.Item value="monthly">
              Monthly
            </SegmentedControl.Item>
          </SegmentedControl.Root>
          <SegmentedControl.Root
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
            size="1"
          >
            <SegmentedControl.Item value="bases">
              Data volume
            </SegmentedControl.Item>
            <SegmentedControl.Item value="projects">
              Projects
            </SegmentedControl.Item>
            <SegmentedControl.Item value="experiments">
              Experiments
            </SegmentedControl.Item>
          </SegmentedControl.Root>
        </Flex>
      </Flex>
      {isLoading ? (
        <Flex direction="column" align="center" justify="center" gap="3" style={{ height: 400 }}>
          <Skeleton width="60%" height="16px" />
          <Text size="2" color="gray">Crunching latest numbers…</Text>
          <Skeleton width="100%" height="300px" />
        </Flex>
      ) : (
        <Chart
          type={view === "cumulative" ? "area" : "line"}
          options={chartOptions}
          series={chartSeries}
          height={400}
          width="100%"
        />
      )}
    </Card>
  );
}

function humanize(value: number): string {
  if (value >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000)
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${value}`;
}

const EB = 1e18;
const PB = 1e15;
const TB = 1e12;
const GB = 1e9;
const MB = 1e6;

function humanizeBytes(value: number): string {
  if (value >= EB) return `${(value / EB).toFixed(1).replace(/\.0$/, "")} EB`;
  if (value >= PB) return `${(value / PB).toFixed(1).replace(/\.0$/, "")} PB`;
  if (value >= TB) return `${(value / TB).toFixed(1).replace(/\.0$/, "")} TB`;
  if (value >= GB) return `${(value / GB).toFixed(1).replace(/\.0$/, "")} GB`;
  if (value >= MB) return `${(value / MB).toFixed(1).replace(/\.0$/, "")} MB`;
  return `${value}`;
}
