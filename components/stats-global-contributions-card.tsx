"use client";

import { SERVER_URL } from "@/utils/constants";
import { humanize } from "@/utils/format";
import { MapView } from "@deck.gl/core";
import { BitmapLayer, ScatterplotLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import DeckGL from "@deck.gl/react";
import { ExportFooter, FOOTER_TEXT, copyBlobToClipboard } from "@/components/chart-footer";
import { Cross1Icon } from "@radix-ui/react-icons";
import {
  Card,
  Flex,
  IconButton,
  Link,
  SegmentedControl,
  Select,
  Skeleton,
  Slider,
  Text,
} from "@radix-ui/themes";
import type { PickingInfo } from "@deck.gl/core";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useMemo, useRef, useState } from "react";

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

const ALL = "__all__";

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

async function fetchFilters(): Promise<FiltersResponse> {
  const res = await fetch(`${SERVER_URL}/stats/global-contribution-filters`);
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
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const activeFilters = {
    organism: organism !== ALL ? organism : undefined,
    assayL2: assayL2 !== ALL ? assayL2 : undefined,
    placeType: placeType !== ALL ? placeType : undefined,
    addressType: addressType !== ALL ? addressType : undefined,
  };

  const { data: filtersData } = useQuery({
    queryKey: ["global-contribution-filters"],
    queryFn: fetchFilters,
    staleTime: Infinity,
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

  const layers = useMemo(
    () => [tileLayer, scatterLayer].filter(Boolean),
    [tileLayer, scatterLayer],
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
          <Text size="5" weight="bold" ml="1">
            Data origin
            {isFetching && !isLoading && (
              <Text size="2" ml="2" style={{ color: "var(--gray-9)" }}>
                updating...
              </Text>
            )}
          </Text>
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
          style={{ height: 500 }}
        >
          <Skeleton width="60%" height="16px" />
          <Text size="2" color="gray">
            Loading contribution map...
          </Text>
          <Skeleton width="100%" height="420px" />
        </Flex>
      ) : (
        <div
          ref={deckContainerRef}
          style={{
            position: "relative",
            width: "100%",
            height: 500,
            borderRadius: "var(--radius-3)",
            overflow: "hidden",
            background: isDark ? "#0d1117" : "#f0f0f0",
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
                        href={`/search?geo_lat=${selectedLocation.point.lat}&geo_lng=${selectedLocation.point.lng}${organism !== ALL ? `&organism=${encodeURIComponent(organism)}` : ""}${assayL2 !== ALL ? `&assay_l2=${encodeURIComponent(assayL2)}` : ""}`}
                        target="_blank"
                        underline="always"
                      >
                        Projects: {selectedLocation.point.n_projects.toLocaleString()}
                      </Link>
                    </Text>
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
    </Card>
  );
}
