"use client";

import { ensureAgGridModules } from "@/lib/ag-grid";
import { SERVER_URL } from "@/utils/constants";
import { humanize } from "@/utils/format";
import { MapView } from "@deck.gl/core";
import { BitmapLayer, GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import DeckGL from "@deck.gl/react";
import { ExportFooter, FOOTER_TEXT, copyBlobToClipboard } from "@/components/chart-footer";
import SectionAnchor from "@/components/section-anchor";
import { Cross1Icon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import {
  Card,
  Flex,
  IconButton,
  Link,
  Popover,
  ScrollArea,
  SegmentedControl,
  Select,
  Skeleton,
  Slider,
  Text,
  TextField,
} from "@radix-ui/themes";
import type { PickingInfo } from "@deck.gl/core";
import { useQuery } from "@tanstack/react-query";
import type { ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useTheme } from "next-themes";
import { useCallback, useMemo, useRef, useState } from "react";

ensureAgGridModules();

type ScaleBy = "projects" | "experiments";

interface Organism {
  name: string;
  count: number;
}

interface LocationPoint {
  lat: number;
  lng: number;
  n_projects: number;
  n_experiments: number;
  n_samples: number;
  n_geo: number;
  n_sra: number;
  n_ae: number;
  n_ena: number;
  country: string | null;
  country_code: string | null;
  city: string | null;
  state: string | null;
  place_name: string | null;
  place_type: string | null;
  short_label: string | null;
  address_type: string | null;
  center_name: string | null;
  top_organisms: Organism[];
}

interface ContributionsResponse {
  locations: LocationPoint[];
  total: number;
  took_ms: number;
}

interface FilterOption {
  value: string;
  count: number;
}

interface FiltersResponse {
  organisms: FilterOption[];
  assay_l1: FilterOption[];
  assay_l2: FilterOption[];
  place_type: FilterOption[];
  address_type: FilterOption[];
  took_ms: number;
}

const INITIAL_VIEW_STATE = {
  longitude: 10,
  latitude: 25,
  zoom: 1.3,
  minZoom: 0.5,
  maxZoom: 12,
  pitch: 0,
  bearing: 0,
};

const LIGHT_TILES = [
  "https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png",
];
const DARK_TILES = [
  "https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
];

const LIGHT_LABEL_TILES = [
  "https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png",
];
const DARK_LABEL_TILES = [
  "https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png",
];

const INDIA_GEOJSON_URL = "/india-states.geojson";

/** Convert an ISO-2 country code to a flag emoji (regional indicator symbols). */
function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "";
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    ...([...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)),
  );
}

const ALL = "__all__";

interface SearchableSelectOption {
  value: string;
  label: string;
}

function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  minWidth = 140,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SearchableSelectOption[];
  placeholder: string;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const displayLabel =
    value === ALL ? placeholder : options.find((o) => o.value === value)?.label ?? value;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <Popover.Trigger>
        <button
          type="button"
          style={{
            minWidth,
            maxWidth: 280,
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
          {displayLabel}
        </button>
      </Popover.Trigger>
      <Popover.Content
        side="bottom"
        align="start"
        sideOffset={4}
        style={{ width: 300, padding: 0 }}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <Flex direction="column" gap="2" p="2">
          <TextField.Root
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            size="2"
          >
            <TextField.Slot>
              <MagnifyingGlassIcon height="16" width="16" />
            </TextField.Slot>
          </TextField.Root>
          <ScrollArea style={{ maxHeight: 240 }} scrollbars="vertical">
            <Flex direction="column">
              <button
                type="button"
                onClick={() => {
                  onValueChange(ALL);
                  setOpen(false);
                  setQuery("");
                }}
                style={{
                  padding: "6px 8px",
                  borderRadius: "var(--radius-1)",
                  border: "none",
                  background: value === ALL ? "var(--accent-a4)" : "transparent",
                  color: "var(--gray-12)",
                  fontSize: "var(--font-size-1)",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                {placeholder}
              </button>
              {filtered.map((o) => (
                <button
                  type="button"
                  key={o.value}
                  onClick={() => {
                    onValueChange(o.value);
                    setOpen(false);
                    setQuery("");
                  }}
                  style={{
                    padding: "6px 8px",
                    borderRadius: "var(--radius-1)",
                    border: "none",
                    background: o.value === value ? "var(--accent-a4)" : "transparent",
                    color: "var(--gray-12)",
                    fontSize: "var(--font-size-1)",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  {o.label}
                </button>
              ))}
              {filtered.length === 0 && (
                <Text size="2" color="gray" style={{ padding: "6px 8px" }}>
                  No results found.
                </Text>
              )}
            </Flex>
          </ScrollArea>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}

const SOURCE_LABELS: { label: string; key: keyof Pick<LocationPoint, "n_geo" | "n_sra" | "n_ae" | "n_ena">; db: string }[] = [
  { label: "GEO", key: "n_geo", db: "geo" },
  { label: "SRA", key: "n_sra", db: "sra" },
  { label: "ArrayExpress", key: "n_ae", db: "arrayexpress" },
  { label: "ENA", key: "n_ena", db: "ena" },
];

function buildGeoSearchParams(
  point: LocationPoint,
  organism: string,
  assayL2: string,
): string {
  const params = new URLSearchParams();
  params.set("geo_lat", String(point.lat));
  params.set("geo_lng", String(point.lng));
  if (organism !== ALL) params.set("organism", organism);
  if (assayL2 !== ALL) params.set("assay_l2", assayL2);
  return params.toString();
}

async function fetchContributions(filters: {
  organism?: string;
  assayL2?: string;
  placeType?: string;
  addressType?: string;
}): Promise<ContributionsResponse> {
  const params = new URLSearchParams();
  if (filters.organism) params.set("organism", filters.organism);
  if (filters.assayL2) params.set("assay_l2", filters.assayL2);
  if (filters.placeType) params.set("place_type", filters.placeType);
  if (filters.addressType) params.set("address_type", filters.addressType);
  const qs = params.toString();
  const url = `${SERVER_URL}/stats/global-contributions${qs ? `?${qs}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch global contributions");
  return res.json();
}

async function fetchFilters(country?: string): Promise<FiltersResponse> {
  const url = country
    ? `${SERVER_URL}/stats/global-contribution-filters?country=${encodeURIComponent(country)}`
    : `${SERVER_URL}/stats/global-contribution-filters`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch filters");
  return res.json();
}

function scaleRadius(value: number, sizeFactor: number): number {
  if (value <= 0) return 0.1 * sizeFactor;
  return Math.max(0.05, Math.min(20, Math.sqrt(value) * 0.1 * sizeFactor));
}

function scaleAlpha(value: number): number {
  if (value <= 0) return 60;
  return Math.max(60, Math.min(210, 40 + Math.log2(value + 1) * 22));
}


export default function StatsGlobalContributionsCard() {
  const [scaleBy, setScaleBy] = useState<ScaleBy>("projects");
  const [pointSize, setPointSize] = useState(1);
  const [organism, setOrganism] = useState(ALL);
  const [assayL2, setAssayL2] = useState(ALL);
  const [placeType, setPlaceType] = useState(ALL);
  const [addressType, setAddressType] = useState(ALL);
  const [selectedCountry, setSelectedCountry] = useState(ALL);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const agGridThemeClassName = isDark ? "ag-theme-quartz-dark" : "ag-theme-quartz";

  const activeFilters = {
    organism: organism !== ALL ? organism : undefined,
    assayL2: assayL2 !== ALL ? assayL2 : undefined,
    placeType: placeType !== ALL ? placeType : undefined,
    addressType: addressType !== ALL ? addressType : undefined,
  };

  const { data: filtersData } = useQuery({
    queryKey: ["global-contribution-filters"],
    queryFn: () => fetchFilters(),
    staleTime: Infinity,
  });

  const { data: countryFiltersData } = useQuery({
    queryKey: ["global-contribution-filters", selectedCountry],
    queryFn: () => fetchFilters(selectedCountry),
    staleTime: Infinity,
    enabled: selectedCountry !== ALL,
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      "global-contributions",
      activeFilters.organism,
      activeFilters.assayL2,
      activeFilters.placeType,
      activeFilters.addressType,
    ],
    queryFn: () => fetchContributions(activeFilters),
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });

  const countryOptions = useMemo(() => {
    if (!data?.locations) return [];
    const agg = new Map<string, { count: number; code: string | null }>();
    for (const loc of data.locations) {
      if (!loc.country) continue;
      const prev = agg.get(loc.country);
      if (prev) {
        prev.count += loc.n_projects;
        if (!prev.code && loc.country_code) prev.code = loc.country_code;
      } else {
        agg.set(loc.country, { count: loc.n_projects, code: loc.country_code });
      }
    }
    return [...agg.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, { count, code }]) => ({ value: name, count, code }));
  }, [data]);

  const countryTableRows = useMemo(() => {
    if (!data?.locations || selectedCountry === ALL) return [];
    return data.locations
      .filter((loc) => loc.country === selectedCountry)
      .sort((a, b) => b.n_projects - a.n_projects);
  }, [data, selectedCountry]);

  const countryTableColumns = useMemo<ColDef<LocationPoint>[]>(
    () => [
      {
        headerName: "Location",
        valueGetter: (p) =>
          p.data?.place_name ||
          [p.data?.city, p.data?.state].filter(Boolean).join(", ") ||
          `${p.data?.lat.toFixed(2)}, ${p.data?.lng.toFixed(2)}`,
        flex: 2,
        minWidth: 160,
      },
      { headerName: "Center", field: "center_name", flex: 2, minWidth: 140 },
      { headerName: "Type", field: "place_type", flex: 1, minWidth: 90 },
      {
        headerName: "Projects",
        field: "n_projects",
        sort: "desc",
        width: 100,
        cellRenderer: (p: { data: LocationPoint; value: number }) => {
          if (!p.data || !p.value) return p.value;
          const qs = buildGeoSearchParams(p.data, organism, assayL2);
          return (
            <Link href={`/search?${qs}`} target="_blank" underline="hover">
              {p.value.toLocaleString()}
            </Link>
          );
        },
      },
      {
        headerName: "Experiments",
        field: "n_experiments",
        width: 115,
        valueFormatter: (p) => p.value?.toLocaleString(),
      },
      {
        headerName: "GEO",
        field: "n_geo",
        width: 80,
        valueFormatter: (p) => p.value?.toLocaleString(),
      },
      {
        headerName: "SRA",
        field: "n_sra",
        width: 80,
        valueFormatter: (p) => p.value?.toLocaleString(),
      },
      {
        headerName: "AE",
        field: "n_ae",
        width: 70,
        valueFormatter: (p) => p.value?.toLocaleString(),
      },
      {
        headerName: "ENA",
        field: "n_ena",
        width: 70,
        valueFormatter: (p) => p.value?.toLocaleString(),
      },
    ],
    [organism, assayL2],
  );

  const activeFilterSource =
    selectedCountry !== ALL && countryFiltersData ? countryFiltersData : filtersData;

  const countrySelectOptions = useMemo<SearchableSelectOption[]>(
    () =>
      countryOptions.map((c) => ({
        value: c.value,
        label: `${countryFlag(c.code)} ${c.value} (${humanize(c.count)})`,
      })),
    [countryOptions],
  );

  const organismSelectOptions = useMemo<SearchableSelectOption[]>(
    () =>
      (activeFilterSource?.organisms ?? [])
        .filter((o) => o.value)
        .map((o) => ({ value: o.value, label: `${o.value} (${humanize(o.count)})` })),
    [activeFilterSource],
  );

  const assaySelectOptions = useMemo<SearchableSelectOption[]>(
    () =>
      (activeFilterSource?.assay_l2 ?? [])
        .filter((a) => a.value)
        .map((a) => ({ value: a.value, label: `${a.value} (${humanize(a.count)})` })),
    [activeFilterSource],
  );

  const tileLayer = useMemo(
    () =>
      new TileLayer({
        id: "basemap-tiles",
        data: isDark ? DARK_TILES : LIGHT_TILES,
        minZoom: 0,
        maxZoom: 19,
        tileSize: 256,
        renderSubLayers: (props: Record<string, unknown>) => {
          const tile = props.tile as {
            boundingBox: [[number, number], [number, number]];
          };
          const { boundingBox } = tile;
          return new BitmapLayer({
            ...props,
            id: props.id as string,
            data: undefined,
            image: props.data as string,
            bounds: [
              boundingBox[0][0],
              boundingBox[0][1],
              boundingBox[1][0],
              boundingBox[1][1],
            ],
            parameters: { depthTest: false },
            opacity: 1,
          });
        },
      }),
    [isDark],
  );

  const sizeFactor = 0.2 + (pointSize / 100) * 1.6;

  const scatterLayer = useMemo(() => {
    if (!data?.locations) return null;

    const fillColor: [number, number, number] = isDark
      ? [56, 189, 248]
      : [37, 99, 235];

    return new ScatterplotLayer<LocationPoint>({
      id: "contributions",
      data: data.locations,
      pickable: true,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: (d) => {
        const val =
          scaleBy === "projects" ? d.n_projects : d.n_experiments;
        return scaleRadius(val, sizeFactor);
      },
      getFillColor: (d) => {
        const val =
          scaleBy === "projects" ? d.n_projects : d.n_experiments;
        return [...fillColor, scaleAlpha(val)] as [
          number,
          number,
          number,
          number,
        ];
      },
      radiusUnits: "common",
      radiusMinPixels: 0.5,
      radiusMaxPixels: 40,
      stroked: false,
      antialiasing: true,
      onClick: (info: PickingInfo<LocationPoint>) => {
        if (info.object) {
          setSelectedLocation({
            point: info.object,
            x: info.x,
            y: info.y,
            containerWidth: deckContainerRef.current?.offsetWidth ?? 600,
          });
        }
      },
      updateTriggers: {
        getRadius: [scaleBy, sizeFactor],
        getFillColor: [scaleBy, isDark],
      },
      transitions: {
        getRadius: 300,
        getFillColor: 300,
      },
    });
  }, [data, scaleBy, isDark, sizeFactor]);

  const indiaBorderLayer = useMemo(
    () =>
      new GeoJsonLayer({
        id: "india-borders",
        data: INDIA_GEOJSON_URL,
        filled: false,
        stroked: true,
        getLineColor: isDark ? [60, 60, 60] : [190, 196, 198],
        getLineWidth: 1,
        lineWidthMinPixels: 0.5,
        lineWidthMaxPixels: 1.5,
        parameters: { depthTest: false },
      }),
    [isDark],
  );

  const labelLayer = useMemo(
    () =>
      new TileLayer({
        id: "label-tiles",
        data: isDark ? DARK_LABEL_TILES : LIGHT_LABEL_TILES,
        minZoom: 0,
        maxZoom: 19,
        tileSize: 512,
        zoomOffset: 1,
        renderSubLayers: (props: Record<string, unknown>) => {
          const tile = props.tile as {
            boundingBox: [[number, number], [number, number]];
          };
          const { boundingBox } = tile;
          return new BitmapLayer({
            ...props,
            id: props.id as string,
            data: undefined,
            image: props.data as string,
            bounds: [
              boundingBox[0][0],
              boundingBox[0][1],
              boundingBox[1][0],
              boundingBox[1][1],
            ],
            parameters: { depthTest: false },
            opacity: 0.6,
          });
        },
      }),
    [isDark],
  );

  const layers = useMemo(
    () =>
      [tileLayer, indiaBorderLayer, scatterLayer, labelLayer].filter(Boolean),
    [tileLayer, indiaBorderLayer, scatterLayer, labelLayer],
  );

  const deckContainerRef = useRef<HTMLDivElement>(null);
  const [selectedLocation, setSelectedLocation] = useState<{
    point: LocationPoint;
    x: number;
    y: number;
    containerWidth: number;
  } | null>(null);

  const chartTitle = useMemo(() => {
    const parts = ["Where is sequencing data generated?"];
    if (organism !== ALL) parts.push(organism);
    if (assayL2 !== ALL) parts.push(assayL2);
    if (placeType !== ALL) parts.push(placeType);
    if (addressType !== ALL) parts.push(addressType);
    return parts.join(" · ");
  }, [organism, assayL2, placeType, addressType]);

  const compositeMapImage = useCallback(
    async (scale = 3): Promise<HTMLCanvasElement | null> => {
      const container = deckContainerRef.current;
      if (!container) return null;
      const srcCanvas = container.querySelector("canvas");
      if (!srcCanvas) return null;

      const w = srcCanvas.width;
      const h = srcCanvas.height;
      const titleH = 40 * scale;
      const footerH = 30 * scale;
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h + titleH + footerH;
      const ctx = out.getContext("2d");
      if (!ctx) return null;

      ctx.fillStyle = isDark ? "#0d1117" : "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);

      ctx.fillStyle = isDark ? "#e6edf3" : "#1c2024";
      ctx.font = `bold ${14 * scale}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(chartTitle, out.width / 2, titleH * 0.65);

      ctx.drawImage(srcCanvas, 0, titleH, w, h);

      ctx.fillStyle = "#999999";
      ctx.font = `${10 * scale}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(FOOTER_TEXT, out.width / 2, h + titleH + footerH * 0.65);

      return out;
    },
    [isDark, chartTitle],
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDownloadPng = useCallback(async (_format: string) => {
    const out = await compositeMapImage(3);
    if (!out) return;
    const link = document.createElement("a");
    link.download = "seqout-global-contributions.png";
    link.href = out.toDataURL("image/png");
    link.click();
  }, [compositeMapImage]);

  const handleCopy = useCallback(async () => {
    const out = await compositeMapImage(3);
    if (!out) return;
    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, "image/png"),
    );
    if (!blob) return;
    await copyBlobToClipboard(blob);
  }, [compositeMapImage]);

  const hasActiveFilter =
    organism !== ALL || assayL2 !== ALL || placeType !== ALL || addressType !== ALL;

  return (
    <Card style={{ width: "100%" }}>
      <Flex justify="between" align="center" mb="3" gap="3" wrap="wrap">
        <Flex direction="column" gap="1">
          <Flex align="center" gap="2">
            <Text size="5" weight="bold" ml="1">
              Data origin
              {isFetching && !isLoading && (
                <Text size="2" ml="2" style={{ color: "var(--gray-9)" }}>
                  updating...
                </Text>
            )}
          </Text>
            <SectionAnchor id="map" />
          </Flex>
          <Text size="2" ml="1" style={{ color: "var(--gray-9)" }}>
            {data
              ? `${humanize(data.total)} locations across ${humanize(data.locations.reduce((s, d) => s + d.n_projects, 0))} projects`
              : "Loading..."}
            {hasActiveFilter && " (filtered)"}
          </Text>
        </Flex>
        <Flex gap="3" align="center" wrap="wrap">
          <Flex gap="2" align="center">
            <Text size="1" style={{ color: "var(--gray-9)" }}>
              Point size
            </Text>
            <Slider
              value={[pointSize]}
              onValueChange={(v) => setPointSize(v[0])}
              min={0}
              max={100}
              step={1}
              size="1"
              style={{ width: 80 }}
            />
          </Flex>
          <SegmentedControl.Root
            value={scaleBy}
            onValueChange={(v) => setScaleBy(v as ScaleBy)}
            size="1"
          >
            <SegmentedControl.Item value="projects">
              Projects
            </SegmentedControl.Item>
            <SegmentedControl.Item value="experiments">
              Experiments
            </SegmentedControl.Item>
          </SegmentedControl.Root>
        </Flex>
      </Flex>

      <Flex gap="3" mb="3" wrap="wrap" align="center">
        <Flex gap="2" align="center">
          <Text size="1" style={{ color: "var(--gray-9)" }}>
            Organism
          </Text>
          <Select.Root value={organism} onValueChange={setOrganism} size="1">
            <Select.Trigger
              style={{ minWidth: 140, maxWidth: 220 }}
              placeholder="All organisms"
            />
            <Select.Content position="popper" sideOffset={4}>
              <Select.Item value={ALL}>All organisms</Select.Item>
              <Select.Separator />
              {filtersData?.organisms.filter((o) => o.value).map((o) => (
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
          <Select.Root value={assayL2} onValueChange={setAssayL2} size="1">
            <Select.Trigger
              style={{ minWidth: 120, maxWidth: 200 }}
              placeholder="All"
            />
            <Select.Content position="popper" sideOffset={4}>
              <Select.Item value={ALL}>All</Select.Item>
              <Select.Separator />
              {filtersData?.assay_l2.filter((a) => a.value).map((a) => (
                <Select.Item key={a.value} value={a.value}>
                  {a.value} ({humanize(a.count)})
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>

        <Flex gap="2" align="center">
          <Text size="1" style={{ color: "var(--gray-9)" }}>
            Place type
          </Text>
          <Select.Root value={placeType} onValueChange={setPlaceType} size="1">
            <Select.Trigger
              style={{ minWidth: 120, maxWidth: 200 }}
              placeholder="All"
            />
            <Select.Content position="popper" sideOffset={4}>
              <Select.Item value={ALL}>All</Select.Item>
              <Select.Separator />
              {filtersData?.place_type?.filter((p) => p.value).map((p) => (
                <Select.Item key={p.value} value={p.value}>
                  {p.value} ({humanize(p.count)})
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>

        <Flex gap="2" align="center">
          <Text size="1" style={{ color: "var(--gray-9)" }}>
            Address type
          </Text>
          <Select.Root value={addressType} onValueChange={setAddressType} size="1">
            <Select.Trigger
              style={{ minWidth: 120, maxWidth: 200 }}
              placeholder="All"
            />
            <Select.Content position="popper" sideOffset={4}>
              <Select.Item value={ALL}>All</Select.Item>
              <Select.Separator />
              {filtersData?.address_type?.filter((a) => a.value).map((a) => (
                <Select.Item key={a.value} value={a.value}>
                  {a.value} ({humanize(a.count)})
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => {
              setOrganism(ALL);
              setAssayL2(ALL);
              setPlaceType(ALL);
              setAddressType(ALL);
            }}
            style={{
              padding: "2px 10px",
              borderRadius: "var(--radius-2)",
              border: "1px solid var(--gray-a7)",
              background: "var(--gray-a3)",
              color: "var(--gray-11)",
              fontSize: "var(--font-size-1)",
              cursor: "pointer",
            }}
          >
            Clear filters
          </button>
        )}
      </Flex>

      {isLoading ? (
        <Flex
          direction="column"
          align="center"
          justify="center"
          gap="3"
          style={{ height: 700 }}
        >
          <Skeleton width="60%" height="16px" />
          <Text size="2" color="gray">
            Loading contribution map...
          </Text>
          <Skeleton width="100%" height="620px" />
        </Flex>
      ) : (
        <div
          ref={deckContainerRef}
          style={{
            position: "relative",
            width: "100%",
            height: 700,
            borderRadius: "var(--radius-3)",
            overflow: "hidden",
            background: isDark ? "#000000" : "#f0f0f0",
          }}
        >
          <DeckGL
            views={new MapView({ repeat: false })}
            initialViewState={INITIAL_VIEW_STATE}
            controller={true}
            layers={layers}
            onClick={(info: PickingInfo<LocationPoint>) => {
              if (!info.object) setSelectedLocation(null);
            }}
          />

          {selectedLocation && (
            <div
              style={{
                position: "absolute",
                left: selectedLocation.x + 12,
                top: Math.max(selectedLocation.y - 10, 8),
                zIndex: 20,
                maxWidth: "min(90%, 320px)",
                pointerEvents: "auto",
                transform:
                  selectedLocation.x > selectedLocation.containerWidth - 340
                    ? "translateX(calc(-100% - 24px))"
                    : undefined,
              }}
            >
              <Card size="1" style={{ boxShadow: "var(--shadow-4)" }}>
                <Flex direction="column" gap="2">
                  <Flex justify="between" align="start" gap="2">
                    <Flex direction="column" gap="0">
                      <Text size="2" weight="bold" style={{ color: "var(--gray-12)" }}>
                        {selectedLocation.point.place_name ||
                          [selectedLocation.point.city, selectedLocation.point.country]
                            .filter(Boolean)
                            .join(", ") ||
                          `${selectedLocation.point.lat.toFixed(2)}, ${selectedLocation.point.lng.toFixed(2)}`}
                      </Text>
                      {selectedLocation.point.center_name &&
                        selectedLocation.point.center_name !== selectedLocation.point.place_name && (
                        <Text size="1" style={{ color: "var(--gray-11)" }}>
                          {selectedLocation.point.center_name}
                        </Text>
                      )}
                      {selectedLocation.point.place_type && (
                        <Text size="1" style={{ color: "var(--gray-9)", fontStyle: "italic" }}>
                          {selectedLocation.point.place_type}
                          {selectedLocation.point.address_type && ` · ${selectedLocation.point.address_type}`}
                        </Text>
                      )}
                      {(selectedLocation.point.city || selectedLocation.point.state || selectedLocation.point.country) && (
                        <Text size="1" style={{ color: "var(--gray-10)" }}>
                          {[selectedLocation.point.city, selectedLocation.point.state, selectedLocation.point.country]
                            .filter(Boolean)
                            .join(", ")}
                        </Text>
                      )}
                    </Flex>
                    <IconButton
                      variant="ghost"
                      size="1"
                      aria-label="Close"
                      onClick={() => setSelectedLocation(null)}
                      style={{ flexShrink: 0 }}
                    >
                      <Cross1Icon />
                    </IconButton>
                  </Flex>

                  <Flex direction="column" gap="0" pt="1" style={{ borderTop: "1px solid var(--gray-a5)" }}>
                    <Text size="1" style={{ color: "var(--gray-12)" }}>
                      <Link
                        href={`/search?${buildGeoSearchParams(selectedLocation.point, organism, assayL2)}`}
                        target="_blank"
                        underline="always"
                      >
                        Projects: {selectedLocation.point.n_projects.toLocaleString()}
                      </Link>
                    </Text>
                    {SOURCE_LABELS
                      .filter((s) => selectedLocation.point[s.key] > 0)
                      .map((s) => (
                        <Text key={s.db} size="1" style={{ color: "var(--gray-11)", paddingLeft: 8 }}>
                          <Link
                            href={`/search?source=${s.db}&${buildGeoSearchParams(selectedLocation.point, organism, assayL2)}`}
                            target="_blank"
                            underline="hover"
                          >
                            {s.label}: {selectedLocation.point[s.key].toLocaleString()}
                          </Link>
                        </Text>
                      ))}
                    <Text size="1" style={{ color: "var(--gray-11)" }}>
                      Experiments: {selectedLocation.point.n_experiments.toLocaleString()}
                    </Text>
                    <Text size="1" style={{ color: "var(--gray-11)" }}>
                      Samples: {selectedLocation.point.n_samples.toLocaleString()}
                    </Text>
                  </Flex>

                  {selectedLocation.point.top_organisms.length > 0 && (
                    <Flex direction="column" gap="0" pt="1" style={{ borderTop: "1px solid var(--gray-a5)" }}>
                      <Text size="1" weight="medium" style={{ color: "var(--gray-10)" }}>Top organisms</Text>
                      {selectedLocation.point.top_organisms.map((o) => (
                        <Text size="1" key={o.name} style={{ color: "var(--gray-12)" }}>
                          {o.name}{" "}
                          <Text size="1" style={{ color: "var(--gray-9)" }}>({o.count.toLocaleString()})</Text>
                        </Text>
                      ))}
                    </Flex>
                  )}
                </Flex>
              </Card>
            </div>
          )}

          <div
            style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              fontSize: "10px",
              color: isDark ? "#6b7280" : "#9ca3af",
              pointerEvents: "none",
            }}
          >
            &copy; OpenStreetMap &copy; CARTO
          </div>
        </div>
      )}

      <ExportFooter
        onCopy={handleCopy}
        onDownload={handleDownloadPng}
        downloadFormats={["png"]}
      />

      <Flex direction="column" gap="3" mt="4" pt="4" style={{ borderTop: "1px solid var(--gray-a5)" }}>
        <Flex align="center" gap="3" wrap="wrap">
          <Text size="3" weight="bold">
            Country breakdown
          </Text>
          <SearchableSelect
            value={selectedCountry}
            onValueChange={setSelectedCountry}
            options={countrySelectOptions}
            placeholder="Select a country"
            minWidth={180}
          />
          <Flex gap="2" align="center">
            <Text size="1" style={{ color: "var(--gray-9)" }}>Organism</Text>
            <SearchableSelect
              value={organism}
              onValueChange={setOrganism}
              options={organismSelectOptions}
              placeholder="All organisms"
              minWidth={140}
            />
          </Flex>
          <Flex gap="2" align="center">
            <Text size="1" style={{ color: "var(--gray-9)" }}>Assay</Text>
            <SearchableSelect
              value={assayL2}
              onValueChange={setAssayL2}
              options={assaySelectOptions}
              placeholder="All assays"
              minWidth={120}
            />
          </Flex>

          {selectedCountry !== ALL && (
            <Text size="1" style={{ color: "var(--gray-9)" }}>
              {countryTableRows.length.toLocaleString()} locations ·{" "}
              {countryTableRows.reduce((s, r) => s + r.n_projects, 0).toLocaleString()} projects
            </Text>
          )}
        </Flex>
        {selectedCountry !== ALL && countryTableRows.length > 0 && (
          <div
            className={agGridThemeClassName}
            style={{ width: "100%", height: Math.min(400, 42 + countryTableRows.length * 36) }}
          >
            <AgGridReact<LocationPoint>
              columnDefs={countryTableColumns}
              defaultColDef={{ resizable: true, sortable: true }}
              rowData={countryTableRows}
              getRowId={(p) => `${p.data.lat}-${p.data.lng}`}
              theme="legacy"
              rowStyle={{ cursor: "pointer" }}
              onRowClicked={(e) => {
                if (e.data) {
                  const qs = buildGeoSearchParams(e.data, organism, assayL2);
                  window.open(`/search?${qs}`, "_blank");
                }
              }}
            />
          </div>
        )}
      </Flex>
    </Card>
  );
}
