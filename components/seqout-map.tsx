"use client";

import { SERVER_URL } from "@/utils/constants";
import { cachedJson, getMapRev, purgeMapCache } from "@/lib/map-cache";
import {
  Cross1Icon,
  MagnifyingGlassIcon,
  Component1Icon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Heading,
  IconButton,
  Link,
  ScrollArea,
  Separator,
  Spinner,
  Switch,
  Text,
  TextField,
  Tooltip,
  Code,
} from "@radix-ui/themes";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  COUNTRY_CHART_COLORS,
  ORGANISM_CHART_COLORS,
} from "./seqout-map/constants.js";

const DEEPSCATTER_ID = "seqout-deepscatter";
const SIDEBAR_WIDTH = 272;
const DESC_LIMIT = 500;

type GeoJson = { features: { properties?: { title?: string } }[] };

type EngineModule = typeof import("./seqout-map/engine.js");
type Scatterplot = Awaited<ReturnType<EngineModule["createMap"]>>["sp"];

type SelectedPoint = {
  accession: string;
  clusterName: string;
  title?: string;
  description?: string;
};

type SearchStatus =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "found"; text: string }
  | { kind: "not-found"; text: string }
  | { kind: "error"; text: string };

type StatsData = {
  empty?: boolean;
  total: number;
  countryCount: number;
  topCountries: [string, number][];
  organisms: [string, number][] | null;
  organismsError?: boolean;
};

type ScreenPoint = { x: number; y: number };

function backgroundForTheme(theme: string | undefined): string {
  return theme === "light" ? "#ffffff" : "#000000";
}

/** Horizontal bar chart used for the lasso stats (top countries / organisms). */
function BarChart({
  entries,
  total,
  palette,
}: {
  entries: [string, number][];
  total: number;
  palette: string[];
}) {
  const max = entries[0]?.[1] || 1;
  return (
    <Flex direction="column" gap="2">
      {entries.map(([name, count], i) => {
        const pct = Math.round((count / total) * 100);
        const width = (count / max) * 100;
        const color = palette[i] ?? palette[palette.length - 1];
        return (
          <Flex key={name} align="center" gap="3">
            <Text
              size="1"
              style={{
                width: 120,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={name}
            >
              {name}
            </Text>
            <Box
              style={{
                flex: 1,
                height: 8,
                borderRadius: 4,
                background: "var(--gray-a3)",
                overflow: "hidden",
              }}
            >
              <Box
                style={{
                  width: `${width}%`,
                  height: "100%",
                  borderRadius: 4,
                  background: color,
                  transition: "width 0.4s ease",
                }}
              />
            </Box>
            <Text size="1" color="gray" style={{ whiteSpace: "nowrap" }}>
              {count}{" "}
              <Text size="1" color="gray">
                ({pct}%)
              </Text>
            </Text>
          </Flex>
        );
      })}
    </Flex>
  );
}

export default function MapGraph() {
  const { resolvedTheme } = useTheme();

  const mapAreaRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const spRef = useRef<Scatterplot | null>(null);
  const engineRef = useRef<EngineModule | null>(null);
  const ctxRef = useRef<{
    clusters: { properties?: { title?: string } }[];
    countries: string[];
    countryColorMap: Record<string, string>;
    clusterColors: string[];
  } | null>(null);
  const themeRef = useRef(resolvedTheme);
  themeRef.current = resolvedTheme;

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countries, setCountries] = useState<string[]>([]);
  const [countryColorMap, setCountryColorMap] = useState<Record<string, string>>({});

  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);

  const [searchValue, setSearchValue] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchStatus>({ kind: "idle" });

  const [colorByClusters, setColorByClusters] = useState(false);
  const [countryFilter, setCountryFilter] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  const [lassoEnabled, setLassoEnabled] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [drawPoints, setDrawPoints] = useState<ScreenPoint[]>([]);
  const [hasSelection, setHasSelection] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsData, setStatsData] = useState<StatsData | null>(null);

  const isDrawingRef = useRef(false);
  const lassoEnabledRef = useRef(false);
  const hasSelectionRef = useRef(false);
  lassoEnabledRef.current = lassoEnabled;
  hasSelectionRef.current = hasSelection;

  // ---- mount: build the scatterplot ---------------------------------------
  useEffect(() => {
    const areaEl = mapAreaRef.current;
    let destroyed = false;
    const controller = new AbortController();

    (async () => {
      if (!areaEl) return;
      const rect = areaEl.getBoundingClientRect();

      try {
      const engine = await import("./seqout-map/engine.js");
      if (destroyed) return;
      engineRef.current = engine;

      const handlePick = async ({
        accession,
        clusterId,
      }: {
        accession: string;
        clusterId?: number;
      }) => {
        try {
          const res = await fetch(`${SERVER_URL}/project/${accession}/metadata`);
          if (!res.ok) return;
          const data = await res.json();
          const clusterName =
            ctxRef.current?.clusters[clusterId ?? -1]?.properties?.title ?? "";
          setSelectedPoint({
            accession,
            clusterName,
            title: data.title,
            description: data.description,
          });
          setDescExpanded(false);
        } catch {
          /* ignore metadata fetch errors */
        }
      };

      // Resolve the current asset version from the backend (this request lazily
      // triggers tile generation the very first time), then load the versioned,
      // purge-revisioned assets — JSON via the browser cache, tiles via the URL
      // we hand to deepscatter.
      const meta = await fetch(`${SERVER_URL}/map/meta`).then((r) => r.json());
      if (destroyed) return;
      const base = `${SERVER_URL}/map/${meta.version}/${getMapRev()}`;
      const [geojson, countries] = await Promise.all([
        cachedJson<GeoJson>(`${base}/geojson.json`),
        cachedJson<string[]>(`${base}/countries.json`),
      ]);
      if (destroyed) return;

      const ctx = await engine.createMap({
        mapSelector: `#${DEEPSCATTER_ID}`,
        width: rect.width,
        height: rect.height,
        tilesUrl: `${base}/tiles`,
        geojson,
        countries,
        backgroundColor: backgroundForTheme(themeRef.current),
        onPick: handlePick,
      });
      if (destroyed) return;

      spRef.current = ctx.sp;
      ctxRef.current = {
        clusters: ctx.clusters,
        countries: ctx.countries,
        countryColorMap: ctx.countryColorMap,
        clusterColors: ctx.clusterColors,
      };
      setCountries(ctx.countries);
      setCountryColorMap(ctx.countryColorMap);
      setLoading(false);
      } catch (err) {
        if (destroyed) return;
        console.error("Failed to load map:", err);
        setError("Could not load map data. Try refreshing.");
        setLoading(false);
      }
    })();

    return () => {
      destroyed = true;
      controller.abort();
      if (areaEl) areaEl.querySelectorAll("canvas").forEach((c) => c.remove());
      spRef.current = null;
    };
  }, []);

  // ---- theme background sync ----------------------------------------------
  useEffect(() => {
    const sp = spRef.current;
    const engine = engineRef.current;
    if (!sp || !engine) return;
    engine.setBackgroundColor(sp, backgroundForTheme(resolvedTheme));
  }, [resolvedTheme]);

  // ---- lasso keyboard (Shift to draw, Escape to cancel) -------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift" && lassoEnabledRef.current && !isDrawingRef.current) {
        setShiftHeld(true);
      }
      if (e.key === "Escape" && lassoEnabledRef.current) {
        isDrawingRef.current = false;
        setDrawPoints([]);
        if (hasSelectionRef.current) {
          const sp = spRef.current;
          if (sp) engineRef.current?.clearLasso(sp);
          setHasSelection(false);
          setStatsOpen(false);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // ---- handlers ------------------------------------------------------------
  const doSearch = useCallback(async () => {
    const sp = spRef.current;
    const engine = engineRef.current;
    if (!sp || !engine) return;
    const id = searchValue.trim();
    if (!id) return;
    setSearchStatus({ kind: "searching" });
    try {
      const found = await engine.runSearch(sp, id);
      if (found) setSearchStatus({ kind: "found", text: found.accession });
      else setSearchStatus({ kind: "not-found", text: id });
    } catch (err) {
      setSearchStatus({ kind: "error", text: (err as Error).message });
    }
  }, [searchValue]);

  const onSearchChange = useCallback((value: string) => {
    setSearchValue(value);
    if (value.trim() === "") {
      const sp = spRef.current;
      if (sp) engineRef.current?.clearSearch(sp);
      setSearchStatus({ kind: "idle" });
    }
  }, []);

  const onToggleColorByClusters = useCallback((value: boolean) => {
    setColorByClusters(value);
    const sp = spRef.current;
    const ctx = ctxRef.current;
    if (sp && ctx) {
      engineRef.current?.setColorByClusters(sp, value, ctx.clusterColors, ctx.clusters);
    }
  }, []);

  const onSelectCountry = useCallback((country: string | null) => {
    setSelectedCountry(country);
    const sp = spRef.current;
    const ctx = ctxRef.current;
    if (sp && ctx) {
      engineRef.current?.applyCountryFilter(
        sp,
        country,
        ctx.countryColorMap,
        ctx.clusterColors,
        ctx.clusters,
      );
    }
  }, []);

  const onToggleLasso = useCallback((value: boolean) => {
    setLassoEnabled(value);
    if (!value) {
      const sp = spRef.current;
      if (sp) engineRef.current?.clearLasso(sp);
      isDrawingRef.current = false;
      setHasSelection(false);
      setDrawPoints([]);
      setStatsOpen(false);
      setShiftHeld(false);
    }
  }, []);

  const onClearLasso = useCallback(() => {
    const sp = spRef.current;
    if (sp) engineRef.current?.clearLasso(sp);
    setHasSelection(false);
    setDrawPoints([]);
    setStatsOpen(false);
  }, []);

  const openStats = useCallback(async () => {
    const sp = spRef.current;
    const engine = engineRef.current;
    if (!sp || !engine) return;
    setStatsOpen(true);
    setStatsLoading(true);
    const { accessions, countryCount, topCountries } = await engine.collectLassoData(sp);
    setStatsLoading(false);
    if (accessions.length === 0) {
      setStatsData({ empty: true, total: 0, countryCount: 0, topCountries: [], organisms: [] });
      return;
    }
    setStatsData({
      total: accessions.length,
      countryCount,
      topCountries,
      organisms: null,
    });
    try {
      const organisms = await engine.fetchOrganismCounts(accessions, SERVER_URL);
      setStatsData((d) => (d ? { ...d, organisms } : d));
    } catch {
      setStatsData((d) => (d ? { ...d, organisms: [], organismsError: true } : d));
    }
  }, []);

  const onToggleStats = useCallback(() => {
    if (statsOpen) setStatsOpen(false);
    else openStats();
  }, [statsOpen, openStats]);

  const onPurge = useCallback(async () => {
    await purgeMapCache();
    // Reload so the map re-initializes against fresh assets under the new
    // purge revision (JSON from the network, tiles past the HTTP cache).
    window.location.reload();
  }, []);

  // ---- lasso pointer drawing ----------------------------------------------
  const coordsOf = (e: React.PointerEvent): ScreenPoint => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!lassoEnabled || e.button !== 0 || !e.shiftKey) return;
    isDrawingRef.current = true;
    setDrawPoints([coordsOf(e)]);
    overlayRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDrawingRef.current) return;
    const c = coordsOf(e);
    setDrawPoints((prev) => [...prev, c]);
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    overlayRef.current?.releasePointerCapture(e.pointerId);
    const points = drawPoints;
    if (points.length < 3) {
      setDrawPoints([]);
      return;
    }
    const sp = spRef.current;
    const engine = engineRef.current;
    if (!sp || !engine) return;
    const dataVerts = points.map((p) => engine.screenToData(sp, p.x, p.y));
    await engine.performLasso(sp, dataVerts);
    setHasSelection(true);
    setSelectedPoint(null);
    setDrawPoints([]);
  };

  // ---- render --------------------------------------------------------------
  const statusColor: Record<SearchStatus["kind"], "gray" | "green" | "red" | "orange"> = {
    idle: "gray",
    searching: "gray",
    found: "green",
    "not-found": "red",
    error: "orange",
  };
  const statusText = (() => {
    switch (searchStatus.kind) {
      case "searching":
        return "Searching…";
      case "found":
        return `Found: ${searchStatus.text}`;
      case "not-found":
        return `Not found: "${searchStatus.text}"`;
      case "error":
        return `Error: ${searchStatus.text}`;
      default:
        return "";
    }
  })();

  const visibleCountries = countries.filter((c) =>
    c.toLowerCase().includes(countryFilter.toLowerCase()),
  );

  const desc = selectedPoint?.description ?? "";
  const descTruncated = desc.length > DESC_LIMIT && !descExpanded;

  return (
    <Flex height="100%" width="100%" style={{ overflow: "hidden", position: "relative" }}>
      {/* Sidebar */}
      <Box
        style={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          background: "var(--color-panel-solid)",
          borderRight: "1px solid var(--gray-a5)",
          overflowY: "auto",
        }}
      >
        {/* Search */}
        <Box p="3">
          <TextField.Root
            value={searchValue}
            placeholder="Search using accession ID"
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch();
            }}
          >
            <TextField.Slot>
              <MagnifyingGlassIcon height="14" width="14" />
            </TextField.Slot>
          </TextField.Root>
          {statusText && (
            <Text as="p" size="1" color={statusColor[searchStatus.kind]} mt="1">
              {statusText}
            </Text>
          )}
        </Box>

        <Separator size="4" />

        {/* Selected point */}
        <Box p="3">
          <Flex align="center" justify="between" mb="2">
            <Text size="1" weight="bold" color="gray" style={{ letterSpacing: "0.06em" }}>
              SELECTED POINT
            </Text>
            {selectedPoint?.accession && (
              <Link href={`/p/${selectedPoint.accession}`} size="1">
                <Code variant="soft" size="1">
                  {selectedPoint.accession}
                </Code>
              </Link>
            )}
          </Flex>
          {!selectedPoint ? (
            <Text size="1" color="gray">
              Click a point to see details
            </Text>
          ) : (
            <Flex direction="column" gap="2">
              {selectedPoint.clusterName && (
                <Box>
                  <Badge color="indigo" variant="soft" radius="full">
                    {selectedPoint.clusterName}
                  </Badge>
                </Box>
              )}
              {selectedPoint.title && (
                <Heading size="3" weight="medium">
                  {selectedPoint.title}
                </Heading>
              )}
              {desc && (
                <Text size="1" color="gray">
                  {descTruncated ? `${desc.slice(0, DESC_LIMIT)}…` : desc}
                  {descTruncated && (
                    <>
                      {" "}
                      <Link
                        size="1"
                        onClick={() => setDescExpanded(true)}
                        style={{ cursor: "pointer" }}
                      >
                        Read more
                      </Link>
                    </>
                  )}
                </Text>
              )}
            </Flex>
          )}
        </Box>

        <Separator size="4" />

        {/* Country filter */}
        <Box p="3">
          <Flex align="center" justify="between" mb="2">
            <Text size="1" weight="bold" color="gray" style={{ letterSpacing: "0.06em" }}>
              COUNTRIES
            </Text>
            <Text as="label" size="1" color="gray">
              <Flex align="center" gap="2">
                Color by cluster
                <Switch
                  size="1"
                  checked={colorByClusters}
                  onCheckedChange={onToggleColorByClusters}
                />
              </Flex>
            </Text>
          </Flex>
          <TextField.Root
            size="1"
            value={countryFilter}
            placeholder="Filter countries"
            onChange={(e) => setCountryFilter(e.target.value)}
            mb="2"
          >
            <TextField.Slot>
              <MagnifyingGlassIcon height="12" width="12" />
            </TextField.Slot>
          </TextField.Root>
          <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: 180 }}>
            <Flex direction="column" gap="1" pr="2">
              {visibleCountries.map((country) => (
                <Text as="label" size="2" key={country} style={{ cursor: "pointer" }}>
                  <Flex align="center" gap="2">
                    <Checkbox
                      size="1"
                      checked={selectedCountry === country}
                      onCheckedChange={(checked) =>
                        onSelectCountry(checked ? country : null)
                      }
                    />
                    <Box
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: countryColorMap[country],
                        border: "1px solid var(--gray-a4)",
                      }}
                    />
                    <Text size="1">{country}</Text>
                  </Flex>
                </Text>
              ))}
            </Flex>
          </ScrollArea>
        </Box>

        <Separator size="4" />

        {/* Lasso */}
        <Box p="3">
          <Flex align="center" justify="between">
            <Flex align="center" gap="2">
              <Component1Icon height="14" width="14" color="var(--gray-9)" />
              <Text size="2" color="gray">
                Lasso select
              </Text>
            </Flex>
            <Switch size="1" checked={lassoEnabled} onCheckedChange={onToggleLasso} />
          </Flex>
          {lassoEnabled && !hasSelection && (
            <Text as="p" size="1" color="gray" mt="2">
              Hold <Code size="1">Shift</Code> and drag on the map to draw a selection.
            </Text>
          )}
          {hasSelection && (
            <Flex direction="column" gap="2" mt="2">
              <Button size="1" variant="soft" color="red" onClick={onClearLasso}>
                Clear selection
              </Button>
              <Button size="1" variant="soft" onClick={onToggleStats}>
                {statsOpen ? "Close lasso stats" : "Show lasso stats"}
              </Button>
            </Flex>
          )}
        </Box>

        <Separator size="4" />

        {/* Data cache */}
        <Box p="3">
          <Tooltip content="Clear the browser cache and reload fresh map data from the server">
            <Button size="1" variant="ghost" color="gray" onClick={onPurge}>
              <UpdateIcon /> Refresh map data
            </Button>
          </Tooltip>
        </Box>
      </Box>

      {/* Map */}
      <Box ref={mapAreaRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <div id={DEEPSCATTER_ID} style={{ position: "absolute", inset: 0 }} />

        {/* lasso polygon (drawn while selecting) */}
        {drawPoints.length > 0 && (
          <svg
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              zIndex: 11,
            }}
          >
            <polygon
              points={drawPoints.map((p) => `${p.x},${p.y}`).join(" ")}
              style={{
                fill: "var(--accent-a3)",
                stroke: "var(--accent-9)",
                strokeWidth: 1.5,
                strokeDasharray: "4 3",
                strokeLinejoin: "round",
                strokeLinecap: "round",
              }}
            />
          </svg>
        )}

        {/* lasso capture overlay */}
        {lassoEnabled && (
          <div
            ref={overlayRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              cursor: "crosshair",
              touchAction: "none",
              userSelect: "none",
              pointerEvents: shiftHeld || isDrawingRef.current ? "auto" : "none",
            }}
          />
        )}

        {(loading || error) && (
          <Flex
            align="center"
            justify="center"
            gap="2"
            style={{ position: "absolute", inset: 0, zIndex: 5 }}
          >
            {error ? (
              <Text size="2" color="red">
                {error}
              </Text>
            ) : (
              <>
                <Spinner />
                <Text size="2" color="gray">
                  Preparing map…
                </Text>
              </>
            )}
          </Flex>
        )}

        {/* lasso stats panel */}
        {statsOpen && (
          <Box
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              maxHeight: "40vh",
              background: "var(--color-panel-solid)",
              borderTop: "1px solid var(--gray-a5)",
              overflowY: "auto",
              zIndex: 20,
            }}
          >
            <Flex
              align="center"
              justify="between"
              px="4"
              py="2"
              style={{ borderBottom: "1px solid var(--gray-a5)" }}
            >
              <Text size="2" weight="medium">
                Summary
              </Text>
              <IconButton size="1" variant="ghost" color="gray" onClick={() => setStatsOpen(false)}>
                <Cross1Icon />
              </IconButton>
            </Flex>
            <Box p="4">
              {statsLoading ? (
                <Flex align="center" gap="2">
                  <Spinner size="1" />
                  <Text size="1" color="gray">
                    Loading…
                  </Text>
                </Flex>
              ) : statsData?.empty ? (
                <Text size="1" color="gray">
                  No points in selection.
                </Text>
              ) : statsData ? (
                <Flex direction="column" gap="3">
                  <Flex direction="column" gap="1">
                    <Text size="1" color="gray">
                      Total points:{" "}
                      <Text size="1" weight="medium">
                        {statsData.total}
                      </Text>
                    </Text>
                    <Text size="1" color="gray">
                      No. of countries:{" "}
                      <Text size="1" weight="medium">
                        {statsData.countryCount}
                      </Text>
                    </Text>
                  </Flex>
                  <Separator size="4" />
                  <Box>
                    <Text size="1" weight="bold" color="gray" style={{ letterSpacing: "0.06em" }}>
                      TOP COUNTRIES
                    </Text>
                    <Box mt="2">
                      <BarChart
                        entries={statsData.topCountries}
                        total={statsData.total}
                        palette={COUNTRY_CHART_COLORS}
                      />
                    </Box>
                  </Box>
                  <Separator size="4" />
                  <Box>
                    <Text size="1" weight="bold" color="gray" style={{ letterSpacing: "0.06em" }}>
                      TOP ORGANISMS
                    </Text>
                    <Box mt="2">
                      {statsData.organisms === null ? (
                        <Flex align="center" gap="2">
                          <Spinner size="1" />
                          <Text size="1" color="gray">
                            Fetching organism data…
                          </Text>
                        </Flex>
                      ) : statsData.organismsError ? (
                        <Text size="1" color="gray">
                          Failed to load organism data.
                        </Text>
                      ) : (
                        <BarChart
                          entries={statsData.organisms}
                          total={statsData.total}
                          palette={ORGANISM_CHART_COLORS}
                        />
                      )}
                    </Box>
                  </Box>
                </Flex>
              ) : null}
            </Box>
          </Box>
        )}
      </Box>
    </Flex>
  );
}
