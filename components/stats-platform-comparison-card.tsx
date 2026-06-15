"use client";

import ChartFooter, { chartFooterEvents } from "@/components/chart-footer";
import SectionAnchor from "@/components/section-anchor";
import { CHART_SERIES_PALETTE } from "@/utils/chart-theme";
import { SERVER_URL } from "@/utils/constants";
import { humanize } from "@/utils/format";
import { fetchJsonWithIndexedDbCache } from "@/utils/indexeddb-cache";
import { loess } from "@/utils/smooth";
import { useReducedMotion } from "@/utils/useReducedMotion";
import { Cross1Icon } from "@radix-ui/react-icons";
import {
  Badge,
  Checkbox,
  Flex,
  Heading,
  IconButton,
  ScrollArea,
  SegmentedControl,
  Skeleton,
  Text,
} from "@radix-ui/themes";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ApexOptions } from "apexcharts";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

type Mode = "experiments" | "projects";
type View = "cumulative" | "monthly";
type DbFilter = "overall" | "geo" | "sra" | "ena";

interface GrowthPoint {
  month: string;
  count: number;
  cumulative: number;
}

interface PlatformGrowthResponse {
  platform: string;
  display_name: string;
  mode: string;
  series: Record<string, GrowthPoint[]>;
  took_ms: number;
}

interface PlatformTotal {
  platform: string;
  display_name: string;
  total: number;
}

interface PlatformTotalsResponse {
  platforms: PlatformTotal[];
  took_ms: number;
}

// Distinct colors for up to 8 comparison platforms, sourced from the
// shared chart-theme palette so all multi-series charts use the same
// 8-step sequence.
const COMPARISON_COLORS = CHART_SERIES_PALETTE;

async function fetchPlatformTotals(): Promise<PlatformTotalsResponse> {
  return fetchJsonWithIndexedDbCache<PlatformTotalsResponse>(
    `${SERVER_URL}/stats/platform-totals`,
  );
}

async function fetchPlatformGrowth(
  platform: string,
  mode: Mode,
): Promise<PlatformGrowthResponse> {
  return fetchJsonWithIndexedDbCache<PlatformGrowthResponse>(
    `${SERVER_URL}/stats/platform-growth?platform=${encodeURIComponent(platform)}&mode=${mode}`,
  );
}

function mergeDbSeries(
  series: Record<string, GrowthPoint[]>,
  db: DbFilter,
): GrowthPoint[] {
  if (db !== "overall") {
    return series[db] ?? [];
  }
  // Sum across all DBs per month
  const byMonth = new Map<string, number>();
  for (const points of Object.values(series)) {
    for (const p of points) {
      byMonth.set(p.month, (byMonth.get(p.month) ?? 0) + p.count);
    }
  }
  const sorted = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let cumulative = 0;
  return sorted.map(([month, count]) => {
    cumulative += count;
    return { month, count, cumulative };
  });
}

export default function StatsPlatformComparisonCard() {
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([
    "ILLUMINA",
    "OXFORD_NANOPORE",
  ]);
  const [mode, setMode] = useState<Mode>("experiments");
  const [view, setView] = useState<View>("cumulative");
  const [logScale, setLogScale] = useState(true);
  const [smooth, setSmooth] = useState(false);
  const [db, setDb] = useState<DbFilter>("overall");
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const reduced = useReducedMotion();

  const { data: totalsData, isLoading: totalsLoading } = useQuery({
    queryKey: ["platform-totals"],
    queryFn: fetchPlatformTotals,
    staleTime: Infinity,
  });

  const displayNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of totalsData?.platforms ?? []) {
      map.set(p.platform, p.display_name);
    }
    return map;
  }, [totalsData]);

  const togglePlatform = useCallback(
    (platform: string) => {
      setSelectedPlatforms((prev) =>
        prev.includes(platform)
          ? prev.filter((p) => p !== platform)
          : prev.length < 8
            ? [...prev, platform]
            : prev,
      );
    },
    [],
  );

  const removePlatform = useCallback((platform: string) => {
    setSelectedPlatforms((prev) => prev.filter((p) => p !== platform));
  }, []);

  // Stable query list: fetch all known platforms (not just selected).
  // This prevents useQueries from remounting when selection changes.
  const allPlatformCodes = useMemo(
    () => (totalsData?.platforms ?? []).map((p) => p.platform),
    [totalsData],
  );

  // All queries stay enabled and use staleTime: Infinity (no refetch).
  // Selection only controls which series appear in the chart, not which queries run.
  // This prevents data loss when deselecting a platform.
  const growthQueries = useQueries({
    queries: allPlatformCodes.map((platform) => ({
      queryKey: ["platform-growth", platform, mode] as const,
      queryFn: () => fetchPlatformGrowth(platform, mode),
      staleTime: Infinity,
    })),
  });

  // Build a lookup from platform code -> query data
  const growthByPlatform = useMemo(() => {
    const map = new Map<string, PlatformGrowthResponse>();
    allPlatformCodes.forEach((code, i) => {
      if (growthQueries[i]?.data) {
        map.set(code, growthQueries[i].data);
      }
    });
    return map;
  }, [allPlatformCodes, growthQueries]);

  const isLoading =
    selectedPlatforms.length > 0 &&
    selectedPlatforms.some(
      (p) => !growthByPlatform.has(p) && allPlatformCodes.includes(p),
    );

  const useSmooth = smooth && view === "monthly";

  const chartSeries = useMemo(() => {
    const result: { name: string; type?: string; data: { x: number; y: number }[]; color: string }[] = [];
    for (let i = 0; i < selectedPlatforms.length; i++) {
      const platform = selectedPlatforms[i];
      const data = growthByPlatform.get(platform);
      if (!data?.series) continue;
      const points = mergeDbSeries(data.series, db);
      if (points.length === 0) continue;
      const xs = points.map((p) => new Date(`${p.month}-01`).getTime());
      const ys = points.map((p) => (view === "cumulative" ? p.cumulative : p.count));
      const color = COMPARISON_COLORS[i % COMPARISON_COLORS.length];
      const label = displayNames.get(platform) ?? platform;

      if (useSmooth) {
        const smoothed = loess(xs, ys, 0.12);
        result.push({
          name: label,
          type: "scatter",
          data: xs.map((x, j) => ({ x, y: ys[j] })),
          color,
        });
        result.push({
          name: `${label} trend`,
          type: "line",
          data: xs.map((x, j) => ({ x, y: Math.max(0, smoothed[j]) })),
          color,
        });
      } else {
        result.push({
          name: label,
          data: xs.map((x, j) => ({ x, y: ys[j] })),
          color,
        });
      }
    }
    return result;
  }, [selectedPlatforms, growthByPlatform, db, view, displayNames, useSmooth]);

  const chartOptions = useMemo<ApexOptions>(() => {
    return {
      chart: {
        id: "seqout-platform-comparison",
        type: useSmooth ? "line" : view === "cumulative" ? "area" : "line",
        background: "transparent",
        toolbar: {
          show: true,
          tools: {
            download: true,
            zoom: true,
            zoomin: true,
            zoomout: true,
            pan: true,
            reset: true,
          },
          export: { svg: { filename: "seqout-platform-comparison" } },
        },
        zoom: { enabled: true },
        animations: { enabled: !reduced },
        events: chartFooterEvents,
      },
      theme: { mode: isDark ? "dark" : "light" },
      grid: { padding: { bottom: 20 } },
      dataLabels: { enabled: false },
      stroke: useSmooth
        ? {
            width: chartSeries.map((s) => (s.type === "scatter" ? 0 : 2.5)),
            curve: "smooth" as const,
          }
        : {
            curve: "straight" as const,
            width: view === "cumulative" ? 2 : 1.5,
          },
      markers: useSmooth
        ? {
            size: chartSeries.map((s) => (s.type === "scatter" ? 2 : 0)),
            strokeWidth: 0,
          }
        : { size: 0 },
      fill: {
        type: view === "cumulative" ? "gradient" : "solid",
        gradient: { opacityFrom: 0.3, opacityTo: 0.02 },
      },
      xaxis: {
        type: "datetime",
        labels: { format: "MMM yyyy", datetimeUTC: false },
      },
      yaxis: {
        logarithmic: logScale,
        labels: { formatter: (val: number) => humanize(Math.round(val)) },
        title: {
          text: mode === "experiments" ? "Experiments" : "Projects",
        },
      },
      tooltip: {
        x: { format: "MMM yyyy" },
        y: { formatter: (val: number) => humanize(val) },
      },
      legend: {
        position: "top",
        horizontalAlign: "left",
        ...(useSmooth
          ? {
              formatter: (name: string) =>
                name.endsWith(" trend") ? "" : name,
            }
          : {}),
      },
    };
  }, [isDark, logScale, view, mode, useSmooth, chartSeries, reduced]);

  const platformOptions = useMemo(() => {
    return (totalsData?.platforms ?? []).map((p) => ({
      platform: p.platform,
      displayName: p.display_name,
      total: p.total,
      selected: selectedPlatforms.includes(p.platform),
    }));
  }, [totalsData, selectedPlatforms]);

  return (
    <Flex
      direction="column"
      width="100%"
      py={{ initial: "4", md: "5" }}
    >
      <Flex direction="column" mb="4" gap="3">
        <Flex align="center" gap="2">
          <Heading as="h2" size="5" weight="bold" ml="1">
            Platform comparison
          </Heading>
          <SectionAnchor id="comparison" />
        </Flex>

        <Flex justify="between" align="center" gap="3" wrap="wrap">
          <Flex align="center" gap="2" wrap="wrap">
            {selectedPlatforms.map((p, i) => (
              <Badge
                key={p}
                size="2"
                style={{
                  backgroundColor: COMPARISON_COLORS[i % COMPARISON_COLORS.length],
                  color: "white",
                }}
              >
                {displayNames.get(p) ?? p}
                <IconButton
                  size="1"
                  variant="ghost"
                  aria-label={`Remove ${displayNames.get(p) ?? p}`}
                  style={{ color: "white", marginLeft: 2 }}
                  onClick={() => removePlatform(p)}
                >
                  <Cross1Icon width="10" height="10" />
                </IconButton>
              </Badge>
            ))}
            {selectedPlatforms.length === 0 && (
              <Text size="2" color="gray">
                Select platforms below
              </Text>
            )}
          </Flex>

          <Flex gap="3" align="center" wrap="wrap">
            <SegmentedControl.Root
              value={db}
              onValueChange={(v) => setDb(v as DbFilter)}
              size="1"
            >
              <SegmentedControl.Item value="overall">
                Overall
              </SegmentedControl.Item>
              <SegmentedControl.Item value="geo">GEO</SegmentedControl.Item>
              <SegmentedControl.Item value="sra">SRA</SegmentedControl.Item>
              <SegmentedControl.Item value="ena">ENA</SegmentedControl.Item>
            </SegmentedControl.Root>
            <SegmentedControl.Root
              value={logScale ? "log" : "linear"}
              onValueChange={(v) => setLogScale(v === "log")}
              size="1"
            >
              <SegmentedControl.Item value="linear">
                Linear
              </SegmentedControl.Item>
              <SegmentedControl.Item value="log">Log</SegmentedControl.Item>
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
            {view === "monthly" && (
              <SegmentedControl.Root
                value={smooth ? "smooth" : "raw"}
                onValueChange={(v) => setSmooth(v === "smooth")}
                size="1"
              >
                <SegmentedControl.Item value="raw">Raw</SegmentedControl.Item>
                <SegmentedControl.Item value="smooth">
                  Smooth
                </SegmentedControl.Item>
              </SegmentedControl.Root>
            )}
            <SegmentedControl.Root
              value={mode}
              onValueChange={(v) => setMode(v as Mode)}
              size="1"
            >
              <SegmentedControl.Item value="experiments">
                Experiments
              </SegmentedControl.Item>
              <SegmentedControl.Item value="projects">
                Projects
              </SegmentedControl.Item>
            </SegmentedControl.Root>
          </Flex>
        </Flex>

        {!totalsLoading && (
          <ScrollArea style={{ maxHeight: 120 }} scrollbars="vertical">
            <Flex gap="3" wrap="wrap">
              {platformOptions.map((p) => (
                <Text as="label" size="1" key={p.platform}>
                  <Flex align="center" gap="1">
                    <Checkbox
                      size="1"
                      checked={p.selected}
                      onCheckedChange={() => togglePlatform(p.platform)}
                    />
                    <span>
                      {p.displayName} ({humanize(p.total)})
                    </span>
                  </Flex>
                </Text>
              ))}
            </Flex>
          </ScrollArea>
        )}
      </Flex>

      {isLoading || totalsLoading ? (
        <Flex
          direction="column"
          align="center"
          justify="center"
          gap="3"
          style={{ height: 400 }}
        >
          <Skeleton width="60%" height="16px" />
          <Text size="2" color="gray">
            Loading comparison data...
          </Text>
          <Skeleton width="100%" height="300px" />
        </Flex>
      ) : chartSeries.length > 0 ? (
        <>
          <Chart
            type={view === "cumulative" ? "area" : "line"}
            options={chartOptions}
            series={chartSeries}
            height={400}
            width="100%"
          />
          <ChartFooter chartId="seqout-platform-comparison" />
        </>
      ) : (
        <Flex align="center" justify="center" style={{ height: 400 }}>
          <Text size="3" color="gray">
            Select platforms to compare.
          </Text>
        </Flex>
      )}
    </Flex>
  );
}
