"use client";

import ChartFooter, { chartFooterEvents } from "@/components/chart-footer";
import SectionAnchor from "@/components/section-anchor";
import { SERVER_URL } from "@/utils/constants";
import { DB_COLORS, DB_LABELS } from "@/utils/db-colors";
import { humanize } from "@/utils/format";
import { fetchJsonWithIndexedDbCache } from "@/utils/indexeddb-cache";
import { loess } from "@/utils/smooth";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import {
  Card,
  Flex,
  Popover,
  ScrollArea,
  SegmentedControl,
  Select,
  Separator,
  Skeleton,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import type { ApexOptions } from "apexcharts";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

type Mode = "experiments" | "projects";
type View = "cumulative" | "monthly";

interface GrowthPoint {
  month: string;
  count: number;
  cumulative: number;
}

interface PlatformGrowthResponse {
  platform: string;
  display_name: string;
  mode: string;
  instrument_model: string | null;
  series: Record<string, GrowthPoint[]>;
  took_ms: number;
}

interface PlatformTotal {
  platform: string;
  display_name: string;
  total: number;
  geo: number;
  sra: number;
  ena: number;
}

interface PlatformTotalsResponse {
  platforms: PlatformTotal[];
  took_ms: number;
}

interface PlatformInstrument {
  instrument_model: string;
  total: number;
}

interface PlatformInstrumentsResponse {
  platform: string;
  instruments: PlatformInstrument[];
  took_ms: number;
}

interface FilterOption {
  value: string;
  count: number;
}

interface PlatformFiltersResponse {
  platform: string;
  organisms: FilterOption[];
  assays: FilterOption[];
  countries: FilterOption[];
  took_ms: number;
}

const ALL = "__all__";
const DB_ORDER = ["geo", "sra", "ena"];

async function fetchPlatformTotals(): Promise<PlatformTotalsResponse> {
  return fetchJsonWithIndexedDbCache<PlatformTotalsResponse>(
    `${SERVER_URL}/stats/platform-totals`,
  );
}

async function fetchPlatformGrowth(
  platform: string,
  mode: Mode,
  instrumentModel: string | null,
  organism: string | null,
  assay: string | null,
  country: string | null,
): Promise<PlatformGrowthResponse> {
  let url = `${SERVER_URL}/stats/platform-growth?platform=${encodeURIComponent(platform)}&mode=${mode}`;
  if (instrumentModel) url += `&instrument_model=${encodeURIComponent(instrumentModel)}`;
  if (organism) url += `&organism=${encodeURIComponent(organism)}`;
  if (assay) url += `&assay=${encodeURIComponent(assay)}`;
  if (country) url += `&country=${encodeURIComponent(country)}`;
  return fetchJsonWithIndexedDbCache<PlatformGrowthResponse>(url);
}

async function fetchPlatformInstruments(
  platform: string,
): Promise<PlatformInstrumentsResponse> {
  return fetchJsonWithIndexedDbCache<PlatformInstrumentsResponse>(
    `${SERVER_URL}/stats/platform-instruments?platform=${encodeURIComponent(platform)}`,
  );
}

async function fetchPlatformFilters(
  platform: string,
): Promise<PlatformFiltersResponse> {
  return fetchJsonWithIndexedDbCache<PlatformFiltersResponse>(
    `${SERVER_URL}/stats/platform-filters?platform=${encodeURIComponent(platform)}`,
  );
}

export default function StatsSequencingTechnologyCard() {
  const [platform, setPlatform] = useState<string>("");
  const [instrumentModel, setInstrumentModel] = useState<string | null>(null);
  const [organism, setOrganism] = useState(ALL);
  const [libraryStrategy, setLibraryStrategy] = useState(ALL);
  const [country, setCountry] = useState(ALL);
  const [mode, setMode] = useState<Mode>("experiments");
  const [view, setView] = useState<View>("cumulative");
  const [logScale, setLogScale] = useState(true);
  const [smooth, setSmooth] = useState(false);
  const [platformQuery, setPlatformQuery] = useState("");
  const [platformOpen, setPlatformOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const activeOrganism = organism !== ALL ? organism : null;
  const activeAssay = libraryStrategy !== ALL ? libraryStrategy : null;
  const activeCountry = country !== ALL ? country : null;

  const { data: totalsData, isLoading: totalsLoading } = useQuery({
    queryKey: ["platform-totals"],
    queryFn: fetchPlatformTotals,
    staleTime: Infinity,
  });

  const selectedPlatform =
    platform || totalsData?.platforms?.[0]?.platform || "";
  const selectedDisplayName =
    totalsData?.platforms?.find((p) => p.platform === selectedPlatform)
      ?.display_name ?? selectedPlatform;

  const { data: instrumentsData } = useQuery({
    queryKey: ["platform-instruments", selectedPlatform],
    queryFn: () => fetchPlatformInstruments(selectedPlatform),
    enabled: !!selectedPlatform,
    staleTime: Infinity,
  });

  const { data: filtersData } = useQuery({
    queryKey: ["platform-filters", selectedPlatform],
    queryFn: () => fetchPlatformFilters(selectedPlatform),
    enabled: !!selectedPlatform,
    staleTime: Infinity,
  });

  const { data: growthData, isLoading: growthLoading } = useQuery({
    queryKey: [
      "platform-growth",
      selectedPlatform,
      mode,
      instrumentModel,
      activeOrganism,
      activeAssay,
      activeCountry,
    ],
    queryFn: () =>
      fetchPlatformGrowth(
        selectedPlatform,
        mode,
        instrumentModel,
        activeOrganism,
        activeAssay,
        activeCountry,
      ),
    enabled: !!selectedPlatform,
  });

  const normalizedPlatformQuery = platformQuery.trim().toLowerCase();
  const platformItems = useMemo(() => {
    const items = (totalsData?.platforms ?? []).map((p) => ({
      value: p.platform,
      label: `${p.display_name} (${humanize(p.total)})`,
      displayName: p.display_name,
    }));
    if (!normalizedPlatformQuery) return items;
    return items.filter((item) =>
      item.displayName.toLowerCase().includes(normalizedPlatformQuery),
    );
  }, [totalsData, normalizedPlatformQuery]);

  const chartSeries = useMemo(() => {
    if (!growthData?.series) return [];
    const useSmooth = smooth && view === "monthly";
    const result: { name: string; type?: string; data: { x: number; y: number }[]; color: string }[] = [];

    for (const db of DB_ORDER) {
      const points = growthData.series[db];
      if (!points?.length) continue;
      const xs = points.map((p) => new Date(`${p.month}-01`).getTime());
      const ys = points.map((p) => (view === "cumulative" ? p.cumulative : p.count));
      const color = DB_COLORS[db];
      const label = DB_LABELS[db] ?? db.toUpperCase();

      if (useSmooth) {
        const smoothed = loess(xs, ys, 0.12);
        // Raw observations as small scatter dots
        result.push({
          name: label,
          type: "scatter",
          data: xs.map((x, i) => ({ x, y: ys[i] })),
          color,
        });
        // LOESS trend line on top
        result.push({
          name: `${label} trend`,
          type: "line",
          data: xs.map((x, i) => ({ x, y: Math.max(0, smoothed[i]) })),
          color,
        });
      } else {
        result.push({
          name: label,
          data: xs.map((x, i) => ({ x, y: ys[i] })),
          color,
        });
      }
    }
    return result;
  }, [growthData, view, smooth]);

  const useSmooth = smooth && view === "monthly";

  const chartOptions = useMemo<ApexOptions>(() => {
    const nVisible = DB_ORDER.filter((db) => growthData?.series[db]?.length).length;

    const opts: ApexOptions = {
      chart: {
        id: "seqout-platform-growth",
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
          export: { svg: { filename: `seqout-platform-${selectedPlatform}` } },
        },
        zoom: { enabled: true },
        animations: { enabled: false },
        events: chartFooterEvents,
      },
      theme: { mode: isDark ? "dark" : "light" },
      grid: { padding: { bottom: 20 } },
      dataLabels: { enabled: false },
      stroke: useSmooth
        ? {
            // Alternating: scatter(0), line(2.5), scatter(0), line(2.5)...
            width: Array.from({ length: nVisible * 2 }, (_, i) => i % 2 === 0 ? 0 : 2.5),
            curve: "smooth" as const,
          }
        : {
            curve: "straight" as const,
            width: view === "cumulative" ? 2 : 1.5,
          },
      markers: useSmooth
        ? {
            // Small dots on scatter series, none on line series
            size: Array.from({ length: nVisible * 2 }, (_, i) => i % 2 === 0 ? 2 : 0),
            strokeWidth: 0,
          }
        : { size: 0 },
      fill: {
        type: view === "cumulative" ? "gradient" : "solid",
        gradient: { opacityFrom: 0.4, opacityTo: 0.05 },
      },
      xaxis: {
        type: "datetime",
        labels: {
          format: "MMM yyyy",
          datetimeUTC: false,
        },
      },
      yaxis: {
        logarithmic: logScale,
        labels: {
          formatter: (val: number) => humanize(Math.round(val)),
        },
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
        showForSingleSeries: true,
        // When smoothing, hide the "trend" line series from legend
        ...(useSmooth
          ? {
              labels: {
                useSeriesColors: true,
              },
              formatter: (name: string) =>
                name.endsWith(" trend") ? "" : name,
            }
          : {}),
      },
    };
    return opts;
  }, [isDark, logScale, view, mode, selectedPlatform, useSmooth, growthData]);

  return (
    <Card style={{ width: "100%" }}>
      <Flex direction="column" mb="4" gap="3">
        <Flex align="center" gap="2">
          <Text size="5" weight="bold" ml="1">
            Sequencing technology
          </Text>
          <SectionAnchor id="sequencing" />
        </Flex>
        <Flex justify="between" align="center" gap="3" wrap="wrap">
          <Flex align="center" gap="2">
            {!totalsLoading && platformItems.length > 0 && (
              <Popover.Root
                open={platformOpen}
                onOpenChange={(open) => {
                  setPlatformOpen(open);
                  if (!open) setPlatformQuery("");
                }}
              >
                <Popover.Trigger>
                  <button
                    type="button"
                    style={{
                      minWidth: 180,
                      maxWidth: 280,
                      height: 24,
                      padding: "0 8px",
                      borderRadius: "var(--radius-2)",
                      border: "1px solid var(--gray-a7)",
                      background: "var(--color-surface)",
                      color: "var(--gray-12)",
                      fontSize: "var(--font-size-1)",
                      lineHeight: "24px",
                      cursor: "pointer",
                      textAlign: "left",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {selectedDisplayName || "Select platform"}
                  </button>
                </Popover.Trigger>
                <Popover.Content
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  style={{ width: 280, padding: 0 }}
                  onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    searchInputRef.current?.focus();
                  }}
                >
                  <Flex direction="column" gap="2" p="2">
                    <TextField.Root
                      ref={searchInputRef}
                      value={platformQuery}
                      onChange={(e) => setPlatformQuery(e.target.value)}
                      placeholder="Search platforms"
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
                        {platformItems.map((item) => (
                          <button
                            type="button"
                            key={item.value}
                            onClick={() => {
                              setPlatform(item.value);
                              setInstrumentModel(null);
                              setOrganism(ALL);
                              setLibraryStrategy(ALL);
                              setCountry(ALL);
                              setPlatformOpen(false);
                              setPlatformQuery("");
                            }}
                            style={{
                              padding: "6px 8px",
                              borderRadius: "var(--radius-1)",
                              border: "none",
                              background:
                                item.value === selectedPlatform
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
                        ))}
                      </Flex>
                    </ScrollArea>
                  </Flex>
                </Popover.Content>
              </Popover.Root>
            )}
            {instrumentsData && instrumentsData.instruments.length > 0 && (
              <Select.Root
                value={instrumentModel ?? "all"}
                onValueChange={(v) =>
                  setInstrumentModel(v === "all" ? null : v)
                }
                size="1"
              >
                <Select.Trigger
                  style={{ minWidth: 160, maxWidth: 240 }}
                  placeholder="All instruments"
                />
                <Select.Content position="popper" sideOffset={4}>
                  <Select.Item value="all">All instruments</Select.Item>
                  {instrumentsData.instruments.map((inst) => (
                    <Select.Item
                      key={inst.instrument_model}
                      value={inst.instrument_model}
                    >
                      {inst.instrument_model} ({humanize(inst.total)})
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            )}
          </Flex>
          <Flex gap="3" align="center" wrap="wrap">
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

        {filtersData && (
          <Flex gap="3" wrap="wrap" align="center">
            <Flex gap="2" align="center">
              <Text size="1" style={{ color: "var(--gray-9)" }}>
                Organism
              </Text>
              <Select.Root
                value={organism}
                onValueChange={setOrganism}
                size="1"
              >
                <Select.Trigger
                  style={{ minWidth: 140, maxWidth: 220 }}
                  placeholder="All organisms"
                />
                <Select.Content position="popper" sideOffset={4}>
                  <Select.Item value={ALL}>All organisms</Select.Item>
                  <Select.Separator />
                  {filtersData.organisms.filter((o) => o.value).map((o) => (
                    <Select.Item key={o.value} value={o.value}>
                      {o.value} ({humanize(o.count)})
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>

            <Flex gap="2" align="center">
              <Text size="1" style={{ color: "var(--gray-9)" }}>
                Assay
              </Text>
              <Select.Root
                value={libraryStrategy}
                onValueChange={setLibraryStrategy}
                size="1"
              >
                <Select.Trigger
                  style={{ minWidth: 120, maxWidth: 200 }}
                  placeholder="All"
                />
                <Select.Content position="popper" sideOffset={4}>
                  <Select.Item value={ALL}>All</Select.Item>
                  <Select.Separator />
                  {filtersData.assays.filter((a) => a.value).map((a) => (
                    <Select.Item key={a.value} value={a.value}>
                      {a.value} ({humanize(a.count)})
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>

            <Flex gap="2" align="center">
              <Text size="1" style={{ color: "var(--gray-9)" }}>
                Country
              </Text>
              <Select.Root
                value={country}
                onValueChange={setCountry}
                size="1"
              >
                <Select.Trigger
                  style={{ minWidth: 120, maxWidth: 200 }}
                  placeholder="All"
                />
                <Select.Content position="popper" sideOffset={4}>
                  <Select.Item value={ALL}>All</Select.Item>
                  <Select.Separator />
                  {filtersData.countries.filter((c) => c.value).map((c) => (
                    <Select.Item key={c.value} value={c.value}>
                      {c.value} ({humanize(c.count)})
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
          </Flex>
        )}
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
            Loading platform growth data...
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
          <ChartFooter chartId="seqout-platform-growth" />
        </>
      ) : (
        <Flex align="center" justify="center" style={{ height: 400 }}>
          <Text size="3" color="gray">
            No data found for this platform.
          </Text>
        </Flex>
      )}
    </Card>
  );
}
