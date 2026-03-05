"use client";

import { SERVER_URL } from "@/utils/constants";
import { DB_COLORS, DB_LABELS } from "@/utils/db-colors";
import { humanize } from "@/utils/format";
import { fetchJsonWithIndexedDbCache } from "@/utils/indexeddb-cache";
import ChartFooter, { chartFooterEvents } from "@/components/chart-footer";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import {
  Card,
  Flex,
  Popover,
  ScrollArea,
  SegmentedControl,
  Skeleton,
  Text,
  TextField,
} from "@radix-ui/themes";
import type { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

type Mode = "absolute" | "percentage";
type View = "cumulative" | "monthly";

interface GrowthPoint {
  month: string;
  count: number;
  cumulative: number;
}

interface OrganismGrowthResponse {
  organism: string;
  mode: string;
  series: Record<string, GrowthPoint[]>;
  took_ms: number;
}

interface OrganismTotal {
  organism: string;
  common_name: string | null;
  geo: number;
  sra: number;
  arrayexpress: number;
  ena: number;
  total: number;
}

interface OrganismTotalsResponse {
  organisms: OrganismTotal[];
  total_organisms: number;
  took_ms: number;
}

const DB_ORDER = ["geo", "sra", "arrayexpress", "ena"];

interface OrganismSearchResult {
  organism: string;
  total: number;
  common_name: string | null;
}

interface OrganismSearchResponse {
  organisms: OrganismSearchResult[];
  took_ms: number;
}

async function fetchOrganismTotals(): Promise<OrganismTotalsResponse> {
  return fetchJsonWithIndexedDbCache<OrganismTotalsResponse>(
    `${SERVER_URL}/stats/organism-totals?limit=20`,
  );
}

async function fetchOrganismSearch(
  q: string,
): Promise<OrganismSearchResponse> {
  return fetchJsonWithIndexedDbCache<OrganismSearchResponse>(
    `${SERVER_URL}/stats/organism-search?q=${encodeURIComponent(q)}&limit=20`,
  );
}

async function fetchOrganismGrowth(
  organism: string,
  mode: Mode,
): Promise<OrganismGrowthResponse> {
  return fetchJsonWithIndexedDbCache<OrganismGrowthResponse>(
    `${SERVER_URL}/stats/organism-growth?organism=${encodeURIComponent(organism)}&mode=${mode}`,
  );
}

export default function StatsOrganismGrowthCard() {
  const [organism, setOrganism] = useState<string>("");
  const [commonName, setCommonName] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("absolute");
  const [view, setView] = useState<View>("cumulative");
  const [logScale, setLogScale] = useState(false);
  const [organismQuery, setOrganismQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [organismOpen, setOrganismOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(organismQuery), 250);
    return () => clearTimeout(id);
  }, [organismQuery]);

  const { data: totalsData, isLoading: totalsLoading } = useQuery({
    queryKey: ["organism-totals"],
    queryFn: fetchOrganismTotals,
    staleTime: Infinity,
  });

  const { data: searchData, isFetching: searchFetching } = useQuery({
    queryKey: ["organism-search", debouncedQuery],
    queryFn: () => fetchOrganismSearch(debouncedQuery),
    staleTime: 60_000,
    enabled: debouncedQuery.length >= 2,
  });

  const selectedOrganism =
    organism || totalsData?.organisms?.[0]?.organism || "";

  const selectedCommonName =
    commonName ?? totalsData?.organisms?.[0]?.common_name ?? null;

  const { data: growthData, isLoading: growthLoading } = useQuery({
    queryKey: ["organism-growth", selectedOrganism, mode],
    queryFn: () => fetchOrganismGrowth(selectedOrganism, mode),
    staleTime: Infinity,
    enabled: !!selectedOrganism,
  });

  const chartSeries = useMemo(() => {
    if (!growthData?.series) return [];
    return DB_ORDER.filter((db) => db in growthData.series).map((db) => {
      const raw = growthData.series[db];
      const points =
        view === "cumulative"
          ? raw.map((p) => ({ month: p.month, count: p.cumulative }))
          : raw;
      return {
        name: DB_LABELS[db] ?? db,
        data: points.map((p) => ({
          x: new Date(p.month + "-01").getTime(),
          y: p.count,
        })),
        color: DB_COLORS[db],
      };
    });
  }, [growthData, view]);

  const xaxisTicks = useMemo(() => {
    if (!growthData?.series) return undefined;
    let minYear = 9999;
    let maxYear = 0;
    for (const pts of Object.values(growthData.series)) {
      for (const p of pts as GrowthPoint[]) {
        const y = parseInt(p.month.slice(0, 4), 10);
        if (y < minYear) minYear = y;
        if (y > maxYear) maxYear = y;
      }
    }
    const ticks: number[] = [];
    for (let y = minYear; y <= maxYear; y++) {
      ticks.push(new Date(y, 0, 1).getTime());
    }
    return ticks;
  }, [growthData]);

  const chartOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        id: "seqout-organism-growth",
        type: view === "cumulative" ? "area" : "line",
        background: isDark ? "#111113" : "#ffffff",
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
          export: {
            png: { filename: `seqout-organism-growth-${selectedOrganism.replace(/\s+/g, "-").toLowerCase()}` },
            svg: { filename: `seqout-organism-growth-${selectedOrganism.replace(/\s+/g, "-").toLowerCase()}` },
          },
        },
        foreColor: isDark ? "#a1a1aa" : "#71717a",
        zoom: { enabled: true },
        animations: { enabled: false },
        events: chartFooterEvents,
      },
      title: {
        text: selectedCommonName
          ? `Organism Growth — ${selectedCommonName.charAt(0).toUpperCase() + selectedCommonName.slice(1)} (${selectedOrganism})`
          : `Organism Growth — ${selectedOrganism}`,
        align: "left",
        style: {
          fontSize: "16px",
          fontWeight: "600",
          fontFamily: "system-ui, sans-serif",
          color: isDark ? "#fafafa" : "#000000",
        },
      },
      subtitle: {
        text: `${view === "cumulative" ? "Cumulative" : "Monthly"} ${mode === "percentage" ? "percentage" : "counts"} across GEO, SRA, ArrayExpress & ENA`,
        align: "left",
        style: {
          fontSize: "12px",
          fontFamily: "system-ui, sans-serif",
          color: isDark ? "#a1a1aa" : "#555555",
        },
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
            return `Jan ${d.getFullYear()}`;
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
            mode === "percentage"
              ? `${value.toFixed(1)}%`
              : humanize(Math.round(value)),
        },
        title: {
          text:
            mode === "percentage"
              ? "% of total experiments"
              : "Experiments",
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
        padding: { bottom: 16 },
      },
      tooltip: {
        theme: isDark ? "dark" : "light",
        x: { format: "MMM yyyy" },
        y: {
          formatter: (value) =>
            mode === "percentage"
              ? `${value.toFixed(2)}%`
              : value.toLocaleString(),
        },
      },
    }),
    [mode, view, logScale, isDark, xaxisTicks, selectedOrganism, selectedCommonName],
  );

  const formatLabel = (o: { organism: string; common_name: string | null; total: number }) =>
    o.common_name
      ? `${o.organism} (${o.common_name}) - ${humanize(o.total)}`
      : `${o.organism} - ${humanize(o.total)}`;

  const defaultItems = useMemo(() => {
    if (!totalsData?.organisms) return [];
    return totalsData.organisms.map((o) => ({
      value: o.organism,
      commonName: o.common_name,
      label: formatLabel(o),
    }));
  }, [totalsData]);

  const searchItems = useMemo(() => {
    if (!searchData?.organisms) return [];
    return searchData.organisms.map((o) => ({
      value: o.organism,
      commonName: o.common_name,
      label: formatLabel(o),
    }));
  }, [searchData]);

  const displayItems = debouncedQuery.length >= 2 ? searchItems : defaultItems;
  const isSearching = debouncedQuery.length >= 2 && searchFetching;

  return (
    <Card style={{ width: "100%" }}>
      <Flex justify="between" align="center" mb="4" gap="3" wrap="wrap">
        <Text size="5" weight="bold" ml="1">
          Organism growth
        </Text>
        <Flex gap="3" align="center" wrap="wrap">
          {!totalsLoading && defaultItems.length > 0 && (
            <Popover.Root
              open={organismOpen}
              onOpenChange={(open) => {
                setOrganismOpen(open);
                if (!open) {
                  setOrganismQuery("");
                  setDebouncedQuery("");
                }
              }}
            >
              <Popover.Trigger>
                <button
                  type="button"
                  style={{
                    minWidth: 220,
                    maxWidth: 350,
                    padding: "4px 12px",
                    borderRadius: "var(--radius-2)",
                    border: "1px solid var(--gray-a7)",
                    background: "var(--color-surface)",
                    color: "var(--gray-12)",
                    fontSize: "var(--font-size-1)",
                    cursor: "pointer",
                    textAlign: "left",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {selectedOrganism || "Select organism"}
                </button>
              </Popover.Trigger>
              <Popover.Content
                side="bottom"
                align="start"
                sideOffset={4}
                style={{ width: 320, padding: 0 }}
                onOpenAutoFocus={(e) => {
                  e.preventDefault();
                  searchInputRef.current?.focus();
                }}
              >
                <Flex direction="column" gap="2" p="2">
                  <TextField.Root
                    ref={searchInputRef}
                    value={organismQuery}
                    onChange={(e) => setOrganismQuery(e.target.value)}
                    placeholder="Search organisms..."
                    size="2"
                  >
                    <TextField.Slot>
                      <MagnifyingGlassIcon height="16" width="16" />
                    </TextField.Slot>
                  </TextField.Root>
                  <ScrollArea
                    style={{ maxHeight: 240 }}
                    scrollbars="vertical"
                  >
                    <Flex direction="column">
                      {isSearching ? (
                        <Text size="2" color="gray" style={{ padding: "6px 8px" }}>
                          Searching...
                        </Text>
                      ) : displayItems.length > 0 ? (
                        displayItems.map((item) => (
                          <button
                            type="button"
                            key={item.value}
                            onClick={() => {
                              setOrganism(item.value);
                              setCommonName(item.commonName);
                              setOrganismOpen(false);
                              setOrganismQuery("");
                              setDebouncedQuery("");
                            }}
                            style={{
                              padding: "6px 8px",
                              borderRadius: "var(--radius-1)",
                              border: "none",
                              background:
                                item.value === selectedOrganism
                                  ? "var(--accent-a4)"
                                  : "transparent",
                              color: "var(--gray-12)",
                              fontSize: "var(--font-size-1)",
                              cursor: "pointer",
                              textAlign: "left",
                              width: "100%",
                            }}
                          >
                            {item.label}
                          </button>
                        ))
                      ) : (
                        <Text size="2" color="gray" style={{ padding: "6px 8px" }}>
                          No organisms found.
                        </Text>
                      )}
                    </Flex>
                  </ScrollArea>
                </Flex>
              </Popover.Content>
            </Popover.Root>
          )}
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
          <SegmentedControl.Root
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
            size="1"
          >
            <SegmentedControl.Item value="absolute">
              Absolute
            </SegmentedControl.Item>
            <SegmentedControl.Item value="percentage">
              Percentage
            </SegmentedControl.Item>
          </SegmentedControl.Root>
        </Flex>
      </Flex>
      {growthLoading || totalsLoading ? (
        <Flex
          direction="column"
          align="center"
          justify="center"
          gap="3"
          style={{ height: 400 }}
        >
          <Skeleton width="60%" height="16px" />
          <Text size="2" color="gray">
            Loading organism growth data…
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
          <ChartFooter chartId="seqout-organism-growth" />
        </>
      ) : (
        <Flex align="center" justify="center" style={{ height: 400 }}>
          <Text size="3" color="gray">
            No experiment data found for this organism.
          </Text>
        </Flex>
      )}
    </Card>
  );
}
