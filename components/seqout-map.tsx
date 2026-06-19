"use client";

import { cachedJson, getMapRev, purgeMapCache } from "@/lib/map-cache";
import { SERVER_URL } from "@/utils/constants";
import {
  BarChartIcon,
  Cross1Icon,
  Cross2Icon,
  DownloadIcon,
  GlobeIcon,
  GroupIcon,
  HamburgerMenuIcon,
  InfoCircledIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import {
  Box,
  Button,
  Callout,
  Checkbox,
  Flex,
  IconButton,
  Kbd,
  ScrollArea,
  Separator,
  Spinner,
  Switch,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import { GeistSans } from "geist/font/sans";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// Layout effect on the client, plain effect on the server (avoids the SSR
// useLayoutEffect warning). Used so the mobile/desktop layout is committed
// before the map measures its container.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const DEEPSCATTER_ID = "seqout-deepscatter";
const SIDEBAR_WIDTH = 272;

type MapMeta = {
  version: string;
  levels: string[];
  cluster_max: Record<string, number>;
  cluster_count: Record<string, number>;
  extent: { minx: number; maxx: number; miny: number; maxy: number };
  filters?: { key: string; label: string; file: string }[];
};

// An enriched facet baked into the tiles: its column key + display label. Tallied
// per lasso selection into a bar chart (no separate value list / filter UI).
type Facet = { key: string; label: string };

type EngineModule = typeof import("./seqout-map/engine.js");
type Scatterplot = Awaited<ReturnType<EngineModule["createMap"]>>["sp"];

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
  // Per enriched facet (organism/tissue/disease/…): top values + counts.
  facets: Record<string, [string, number][]>;
};

type ScreenPoint = { x: number; y: number };

function backgroundForTheme(theme: string | undefined): string {
  return theme === "light" ? "#ffffff" : "#000000";
}

/** Horizontal bar chart used for the lasso stats (top countries / organisms). */
function BarChart({
  entries,
  total,
  fullLabels = false,
}: {
  entries: [string, number][];
  total: number;
  fullLabels?: boolean;
}) {
  const max = entries[0]?.[1] || 1;
  return (
    <Flex direction="column" gap="2">
      {entries.map(([name, count]) => {
        const pct = Math.round((count / total) * 100);
        const width = (count / max) * 100;
        return (
          <Flex key={name} align="center" gap="2">
            <Text
              size="1"
              style={
                fullLabels
                  ? { width: 100, flexShrink: 0 }
                  : {
                      width: 120,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }
              }
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
                  background: "var(--accent-9)",
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
    countries: string[];
    clusterColors: string[];
    destroy?: () => void;
  } | null>(null);
  const themeRef = useRef(resolvedTheme);
  useEffect(() => {
    themeRef.current = resolvedTheme;
  }, [resolvedTheme]);

  // Mobile: the sidebar collapses into a left drawer so the map gets full width.
  const [isMobile, setIsMobile] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useIsoLayoutEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const update = () => {
      setIsMobile(mq.matches);
      setLayoutReady(true);
    };
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countries, setCountries] = useState<string[]>([]);

  const [searchValue, setSearchValue] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchStatus>({
    kind: "idle",
  });

  const [colorByClusters, setColorByClusters] = useState(false);
  const [countryFilter, setCountryFilter] = useState("");
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);

  // Enriched facets (organism/tissue/…), shown as bar charts in the lasso stats.
  const [facets, setFacets] = useState<Facet[]>([]);

  const [shiftHeld, setShiftHeld] = useState(false);
  const [drawPoints, setDrawPoints] = useState<ScreenPoint[]>([]);
  const [hasSelection, setHasSelection] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsData, setStatsData] = useState<StatsData | null>(null);

  const isDrawingRef = useRef(false);
  // Mirror of isDrawingRef for render (pointerEvents); ref stays for sync reads in handlers.
  const [isDrawing, setIsDrawing] = useState(false);
  const setDrawing = (value: boolean) => {
    isDrawingRef.current = value;
    setIsDrawing(value);
  };
  const hasSelectionRef = useRef(false);
  useEffect(() => {
    hasSelectionRef.current = hasSelection;
  }, [hasSelection]);
  const accessionsRef = useRef<string[]>([]);

  // ---- mount: build the scatterplot ---------------------------------------
  useEffect(() => {
    if (!layoutReady) return;

    const areaEl = mapAreaRef.current;
    let destroyed = false;
    const controller = new AbortController();

    (async () => {
      if (!areaEl) return;

      // On mobile the container can measure 0×0 on first paint (dynamic browser
      // toolbars / 100dvh settling); deepscatter throws if built at zero size.
      // Wait for a real box before initializing.
      let rect = areaEl.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        await new Promise<void>((resolve) => {
          const ro = new ResizeObserver(() => {
            const r = areaEl.getBoundingClientRect();
            if (destroyed || (r.width && r.height)) {
              ro.disconnect();
              resolve();
            }
          });
          ro.observe(areaEl);
        });
        if (destroyed) return;
        rect = areaEl.getBoundingClientRect();
      }

      try {
        const engine = await import("./seqout-map/engine.js");
        if (destroyed) return;
        engineRef.current = engine;

        // Resolve the current asset version from the backend (this request lazily
        // triggers tile generation the very first time), then load the versioned,
        // purge-revisioned assets — JSON via the browser cache, tiles via the URL
        // we hand to deepscatter.
        const meta: MapMeta = await fetch(`${SERVER_URL}/map/meta`).then((r) =>
          r.json(),
        );
        if (destroyed) return;
        const base = `${SERVER_URL}/map/${meta.version}/${getMapRev()}`;
        const countries = await cachedJson<string[]>(`${base}/countries.json`);
        if (destroyed) return;

        // Enriched facets baked into the tiles — used to label the lasso-stats bar
        // charts and to force-load those columns. No value lists needed (counts
        // come straight from the tiles when a lasso is drawn).
        const facetList: Facet[] = (meta.filters ?? []).map((f) => ({
          key: f.key,
          label: f.label,
        }));

        const ctx = await engine.createMap({
          mapSelector: `#${DEEPSCATTER_ID}`,
          width: rect.width,
          height: rect.height,
          tilesUrl: `${base}/tiles`,
          labelsBase: `${SERVER_URL}/map/labels`,
          clusterMax: meta.cluster_max,
          clusterCount: meta.cluster_count,
          levels: meta.levels,
          extent: meta.extent,
          countries,
          filterColumns: facetList.map((f) => f.key),
          backgroundColor: backgroundForTheme(themeRef.current),
          labelFont: GeistSans.style.fontFamily,
          serverUrl: SERVER_URL,
        });
        if (destroyed) return;

        spRef.current = ctx.sp;
        ctxRef.current = {
          countries: ctx.countries,
          clusterColors: ctx.clusterColors,
          destroy: ctx.destroy,
        };
        setCountries(ctx.countries);
        setFacets(facetList);
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
      ctxRef.current?.destroy?.();
      if (areaEl) areaEl.querySelectorAll("canvas").forEach((c) => c.remove());
      spRef.current = null;
    };
  }, [layoutReady, isMobile]);

  // ---- theme background sync ----------------------------------------------
  useEffect(() => {
    const sp = spRef.current;
    const engine = engineRef.current;
    if (!sp || !engine) return;
    engine.setBackgroundColor(sp, backgroundForTheme(resolvedTheme));
  }, [resolvedTheme]);

  // ---- lasso keyboard (Shift to draw, Escape to cancel) -------------------
  useEffect(() => {
    if (isMobile) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift" && !isDrawingRef.current) {
        setShiftHeld(true);
      }
      if (e.key === "Escape") {
        setDrawing(false);
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
  }, [isMobile]);

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
      engineRef.current?.setColorByClusters(sp, value, ctx.clusterColors);
    }
  }, []);

  const onToggleCountry = useCallback((country: string, checked: boolean) => {
    setSelectedCountries((prev) => {
      const next = checked
        ? [...prev, country]
        : prev.filter((c) => c !== country);
      const sp = spRef.current;
      if (sp) engineRef.current?.applyFilters(sp, { countries: next });
      return next;
    });
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
    const { accessions, countryCount, topCountries, facets } =
      await engine.collectLassoData(sp);
    accessionsRef.current = accessions;
    setStatsLoading(false);
    if (accessions.length === 0) {
      setStatsData({
        empty: true,
        total: 0,
        countryCount: 0,
        topCountries: [],
        facets: {},
      });
      return;
    }
    setStatsData({
      total: accessions.length,
      countryCount,
      topCountries,
      facets,
    });
  }, []);

  const onToggleStats = useCallback(() => {
    if (statsOpen) setStatsOpen(false);
    else openStats();
  }, [statsOpen, openStats]);

  const downloadAccessions = useCallback(() => {
    const accessions = accessionsRef.current;
    if (accessions.length === 0) return;
    const csv = ["accessions", ...accessions].join("\n") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lasso-accessions.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

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
    if (isMobile) return;
    if (e.button !== 0 || !e.shiftKey) return;
    setDrawing(true);
    setDrawPoints([coordsOf(e)]);
    overlayRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (isMobile) return;
    if (!isDrawingRef.current) return;
    const c = coordsOf(e);
    setDrawPoints((prev) => [...prev, c]);
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    if (isMobile) return;
    if (!isDrawingRef.current) return;
    setDrawing(false);
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
    setDrawPoints([]);
    openStats();
  };

  // ---- render --------------------------------------------------------------
  const statusColor: Record<
    SearchStatus["kind"],
    "gray" | "green" | "red" | "orange"
  > = {
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

  return (
    <Flex
      height="100%"
      width="100%"
      style={{ overflow: "hidden", position: "relative" }}
    >
      {/* deepscatter hardcodes the hover tooltip to inline background:ivory + black
          text; retheme it with Radix vars so it follows light/dark. */}
      <style>{`
        #${DEEPSCATTER_ID} .tooltip {
          background: var(--color-panel-solid) !important;
          color: var(--gray-12);
          border: 1px solid var(--gray-a5);
          /* deepscatter anchors the box below the point; nudge it right so it
             sits at the point's bottom-right. */
          margin-left: 14px;
          width: 27rem;
          font-size: 12px;
          text-align: left;
          white-space: normal;
          box-shadow: 0 4px 16px var(--black-a6);
        }
      `}</style>

      {/* Mobile drawer backdrop */}
      {isMobile && drawerOpen && (
        <Box
          onClick={() => setDrawerOpen(false)}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 29,
            background: "var(--black-a6)",
          }}
        />
      )}

      {/* Mobile drawer toggle */}
      {isMobile && !drawerOpen && (
        <IconButton
          variant="soft"
          highContrast
          aria-label="Open map controls"
          onClick={() => setDrawerOpen(true)}
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            zIndex: 25,
            boxShadow: "0 2px 8px var(--black-a6)",
          }}
        >
          <HamburgerMenuIcon />
        </IconButton>
      )}

      {/* Sidebar (drawer on mobile) */}
      <Box
        style={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--color-panel-solid)",
          borderRight: "1px solid var(--gray-a5)",
          overflowY: "auto",
          ...(isMobile
            ? {
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                maxWidth: "85vw",
                zIndex: 30,
                transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
                transition: "transform 0.25s ease",
                boxShadow: drawerOpen ? "0 0 40px var(--black-a8)" : "none",
              }
            : {}),
        }}
      >
        {isMobile && (
          <Flex justify="end" px="3" pt="3">
            <IconButton
              variant="ghost"
              color="gray"
              aria-label="Close controls"
              onClick={() => setDrawerOpen(false)}
            >
              <Cross1Icon />
            </IconButton>
          </Flex>
        )}

        {/* Search */}
        <Flex p="3" direction={"column"} gap={"2"}>
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
        </Flex>

        <Separator size="4" />

        {/* Country filter */}
        <Box p="3" style={{ display: "flex", flexDirection: "column" }}>
          <Flex align="center" justify="between" mb="2">
            <Flex align={"center"} gap={"2"}>
              <GlobeIcon />
              <Text size="2">Countries</Text>
            </Flex>
            <Text as="label" size="2">
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
          <ScrollArea
            type="auto"
            scrollbars="vertical"
            style={{ maxHeight: 240 }}
          >
            <Flex direction="column" gap="1" pr="2">
              {visibleCountries.map((country) => (
                <Text
                  as="label"
                  size="2"
                  key={country}
                  style={{ cursor: "pointer" }}
                >
                  <Flex align="center" gap="2">
                    <Checkbox
                      size="1"
                      checked={selectedCountries.includes(country)}
                      onCheckedChange={(checked) =>
                        onToggleCountry(country, checked === true)
                      }
                    />
                    <Text size="1">{country}</Text>
                  </Flex>
                </Text>
              ))}
            </Flex>
          </ScrollArea>
        </Box>


        {!isMobile && (
          <>
            {/* Lasso */}
            <Box p="3">
              <Flex align="center" justify="between">
                <Flex align="center" gap="2">
                  <GroupIcon />
                  <Text size="2">Lasso select</Text>
                </Flex>
                <Tooltip content="Select a subset of the map">
                  <InfoCircledIcon color="var(--gray-9)" />
                </Tooltip>
              </Flex>
              {!hasSelection && (
                <Callout.Root mt="4">
                  <Callout.Text>
                    Hold <Kbd>Shift</Kbd> and drag on the map to draw a
                    selection.
                  </Callout.Text>
                </Callout.Root>
              )}
              {hasSelection && (
                <Flex direction="column" gap="2" mt="2">
                  <Button
                    size="2"
                    variant="soft"
                    color="red"
                    onClick={onClearLasso}
                  >
                    <TrashIcon />
                    Clear selection
                  </Button>
                  <Button size="2" variant="soft" onClick={onToggleStats}>
                    {statsOpen ? <Cross2Icon /> : <BarChartIcon />}
                    {statsOpen ? "Close lasso stats" : "Show lasso stats"}
                  </Button>
                </Flex>
              )}
            </Box>
          </>
        )}

        {/* Data cache */}
        <Box p="3">
          <Separator size="4" mb="3" />
          <Tooltip content="Clear the browser cache and reload fresh map data from the server">
            <Button
              size="2"
              mb={"4"}
              variant="soft"
              onClick={onPurge}
              style={{ width: "100%" }}
            >
              <UpdateIcon /> Refresh data
            </Button>
          </Tooltip>
        </Box>
      </Box>

      {/* Map */}
      <Box
        ref={mapAreaRef}
        style={{ position: "relative", flex: 1, minWidth: 0 }}
      >
        <div id={DEEPSCATTER_ID} style={{ position: "absolute", inset: 0 }} />

        {/* lasso polygon (drawn while selecting) */}
        {!isMobile && drawPoints.length > 0 && (
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
        {!isMobile && (
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
              pointerEvents: shiftHeld || isDrawing ? "auto" : "none",
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
        {!isMobile && statsOpen && (
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
              <Flex align="center" gap="2">
                <Button
                  size="2"
                  variant="soft"
                  onClick={downloadAccessions}
                  disabled={!statsData || statsData.empty}
                >
                  <DownloadIcon />
                  Accessions
                </Button>
                <IconButton
                  size="2"
                  variant="outline"
                  color="red"
                  aria-label="Close lasso stats"
                  onClick={() => setStatsOpen(false)}
                >
                  <Cross1Icon />
                </IconButton>
              </Flex>
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
                  </Flex>
                  <Separator size="4" />
                  <Flex gap="5" align="start" wrap="wrap">
                    <Box style={{ flex: "1 1 220px", minWidth: 200 }}>
                      <Text size="2" weight="bold">
                        Countries
                      </Text>
                      <Box mt="2">
                        <BarChart
                          entries={statsData.topCountries}
                          total={statsData.total}
                        />
                      </Box>
                    </Box>
                    {facets.map((f) => {
                      const entries = statsData!.facets[f.key] ?? [];
                      return (
                        <Box
                          key={f.key}
                          style={{ flex: "1 1 220px", minWidth: 200 }}
                        >
                          <Text size="2" weight="bold">
                            {f.label}
                          </Text>
                          <Box mt="2">
                            {entries.length > 0 ? (
                              <BarChart
                                entries={entries}
                                total={statsData!.total}
                                fullLabels
                              />
                            ) : (
                              <Text size="1" color="gray">
                                No data
                              </Text>
                            )}
                          </Box>
                        </Box>
                      );
                    })}
                  </Flex>
                </Flex>
              ) : null}
            </Box>
          </Box>
        )}
      </Box>
    </Flex>
  );
}
