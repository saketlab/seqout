"use client";

import { cachedJson, getMapRev, purgeMapCache } from "@/lib/map-cache";
import { SERVER_URL } from "@/utils/constants";
import { normalizeAliases } from "@/utils/project";
import {
  BarChartIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Cross1Icon,
  Cross2Icon,
  DownloadIcon,
  GlobeIcon,
  GroupIcon,
  HamburgerMenuIcon,
  InfoCircledIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  TokensIcon,
  TrashIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  Flex,
  IconButton,
  Kbd,
  Link,
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
// Cap on the cluster picker's list. The fine layers have tens of thousands of
// clusters, so at those zooms the list is the N biggest, not all of them.
const CLUSTER_LIST_LIMIT = 2000;
const SIDEBAR_WIDTH = 272;
const MOBILE_MAP_BREAKPOINT = 768;
const DESKTOP_RENDER_LIMITS = {
  maxPoints: 1000000,
  labelLimit: 400,
  pointSize: 0.1,
  alpha: 25,
  initialDuration: 500,
};
const MOBILE_RENDER_LIMITS = {
  maxPoints: 350000,
  labelLimit: 160,
  pointSize: 0.12,
  alpha: 20,
  initialDuration: 0,
};

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

// A named cluster of the picker's layer, with its centroid (so selecting one can
// fly the view to it).
type Cluster = { id: string; label: string; x: number; y: number };

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

function hasWebGLSupport(): boolean {
  const canvas = document.createElement("canvas");
  return Boolean(
    canvas.getContext("webgl2") ||
    canvas.getContext("webgl") ||
    canvas.getContext("experimental-webgl"),
  );
}

const ACCESSION_LIKE = /^(GSE\d+|[SED]RP\d+|PRJ[A-Z]*\d+|E-[A-Z0-9-]+)$/i;

function addAliasCandidate(
  aliases: Set<string>,
  candidate: unknown,
  searchedAccession: string,
) {
  if (typeof candidate !== "string") return;
  const trimmed = candidate.trim();
  if (!trimmed) return;
  if (trimmed.toUpperCase() === searchedAccession.toUpperCase()) return;
  if (!ACCESSION_LIKE.test(trimmed)) return;
  aliases.add(trimmed);
}

function collectAccessionStrings(
  value: unknown,
  aliases: Set<string>,
  searchedAccession: string,
) {
  if (typeof value === "string") {
    addAliasCandidate(aliases, value, searchedAccession);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) =>
      collectAccessionStrings(item, aliases, searchedAccession),
    );
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) =>
      collectAccessionStrings(item, aliases, searchedAccession),
    );
  }
}

function addDerivedGeoArrayExpressAlias(
  aliases: Set<string>,
  searchedAccession: string,
) {
  const normalized = searchedAccession.toUpperCase();
  const geod = normalized.match(/^E-GEOD-(\d+)$/);
  if (geod) {
    aliases.add(`GSE${geod[1]}`);
    return;
  }
  const gse = normalized.match(/^GSE(\d+)$/);
  if (gse) aliases.add(`E-GEOD-${gse[1]}`);
}

async function fetchAliasCandidates(accession: string): Promise<string[]> {
  const aliases = new Set<string>();
  addDerivedGeoArrayExpressAlias(aliases, accession);

  const fetchJson = async (path: string) => {
    try {
      const res = await fetch(`${SERVER_URL}${path}`);
      if (!res.ok) return null;
      return res.json() as Promise<unknown>;
    } catch {
      return null;
    }
  };

  const project = await fetchJson(`/project/${encodeURIComponent(accession)}`);
  if (project && typeof project === "object") {
    const data = project as { accession?: unknown; alias?: unknown };
    addAliasCandidate(aliases, data.accession, accession);
    normalizeAliases(
      typeof data.alias === "string" || Array.isArray(data.alias)
        ? data.alias
        : null,
    ).forEach((alias) => addAliasCandidate(aliases, alias, accession));
  }

  const xref = await fetchJson(
    `/project/${encodeURIComponent(accession)}/xref`,
  );
  collectAccessionStrings(xref, aliases, accession);

  return Array.from(aliases);
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
  const resizeSnapshotRef = useRef<{ width: number; height: number } | null>(
    null,
  );

  // Mobile: the sidebar collapses into a left drawer so the map gets full width.
  const [isMobile, setIsMobile] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mapSizeRevision, setMapSizeRevision] = useState(0);
  useIsoLayoutEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAP_BREAKPOINT}px)`);
    const update = () => {
      setIsMobile(mq.matches);
      setLayoutReady(true);
    };
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!layoutReady) return;
    const areaEl = mapAreaRef.current;
    if (!areaEl || typeof ResizeObserver === "undefined") return;

    const readSize = () => {
      const rect = areaEl.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      return width && height ? { width, height } : null;
    };

    const initial = readSize();
    if (initial) resizeSnapshotRef.current = initial;

    let timer: number | undefined;
    const ro = new ResizeObserver(() => {
      const next = readSize();
      if (!next) return;
      const prev = resizeSnapshotRef.current;
      if (!prev) {
        resizeSnapshotRef.current = next;
        return;
      }

      const widthDelta = Math.abs(next.width - prev.width);
      const heightDelta = Math.abs(next.height - prev.height);
      if (widthDelta < 16 && heightDelta < 32) return;

      resizeSnapshotRef.current = next;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(
        () => setMapSizeRevision((revision) => revision + 1),
        isMobile ? 160 : 220,
      );
    });

    ro.observe(areaEl);
    return () => {
      if (timer) window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [isMobile, layoutReady]);

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

  // Cluster picker: the named clusters of the layer the current zoom is on (the
  // same layer the points are colored and labeled by). Selecting some hides every
  // point outside them (a facet filter on that layer's tile column).
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [clusterLevel, setClusterLevel] = useState<string | null>(null);
  const [clusterQuery, setClusterQuery] = useState("");
  const [selectedClusters, setSelectedClusters] = useState<string[]>([]);
  const [clusterCardExpanded, setClusterCardExpanded] = useState(true);

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
  const colorByClustersRef = useRef(colorByClusters);
  const selectedCountriesRef = useRef(selectedCountries);
  const selectedClustersRef = useRef(selectedClusters);
  const clusterLevelRef = useRef<string | null>(null);
  useEffect(() => {
    colorByClustersRef.current = colorByClusters;
  }, [colorByClusters]);
  useEffect(() => {
    selectedCountriesRef.current = selectedCountries;
  }, [selectedCountries]);
  useEffect(() => {
    selectedClustersRef.current = selectedClusters;
  }, [selectedClusters]);

  // The engine replaces the whole facet set on every call, so both dimensions go
  // together. Clusters filter on the cluster column of their layer.
  const applySelections = useCallback(
    (countries: string[], clusterIds: string[]) => {
      const sp = spRef.current;
      if (!sp) return;
      const level = clusterLevelRef.current;
      engineRef.current?.applyFilters(sp, {
        countries,
        ...(level ? { [level]: clusterIds } : {}),
      });
    },
    [],
  );

  // Point the picker at a cluster layer: list its clusters (whole layer — the
  // labels endpoint returns everything when no bbox is passed). Called by the
  // engine whenever the zoom crosses into a new layer.
  const clusterCacheRef = useRef(new Map<string, Cluster[]>());
  const loadClusterLevel = useCallback(async (level: string | null) => {
    // Cluster ids are per-layer, so a level switch would invalidate an active
    // selection (and the fly-to on select changes the zoom → the level). Stay put
    // until the user clears; then the picker follows the zoom again.
    if (selectedClustersRef.current.length > 0) return;
    if (!level || level === clusterLevelRef.current) return;
    clusterLevelRef.current = level;
    setClusterLevel(level);

    const cached = clusterCacheRef.current.get(level);
    if (cached) {
      setClusters(cached);
      return;
    }
    try {
      const fc: {
        features: {
          geometry: { coordinates: [number, number] };
          properties: { label: string; cluster_id: number };
        }[];
      } = await fetch(
        `${SERVER_URL}/map/labels?level=${level}&limit=${CLUSTER_LIST_LIMIT}`,
      ).then((r) => r.json());
      const list: Cluster[] = fc.features.map((f) => ({
        id: String(f.properties.cluster_id),
        label: f.properties.label,
        x: f.geometry.coordinates[0],
        y: f.geometry.coordinates[1],
      }));
      clusterCacheRef.current.set(level, list);
      if (clusterLevelRef.current === level) setClusters(list); // ignore stale
    } catch (err) {
      console.error("Failed to load clusters:", err);
    }
  }, []);

  useEffect(() => {
    if (!layoutReady) return;

    const areaEl = mapAreaRef.current;
    let destroyed = false;
    const resetForRemount = mapSizeRevision > 0;
    window.requestAnimationFrame(() => {
      if (destroyed) return;
      setLoading(true);
      setError(null);
      if (resetForRemount) {
        setDrawing(false);
        setDrawPoints([]);
        setHasSelection(false);
        setStatsOpen(false);
      }
    });
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
        if (!hasWebGLSupport()) {
          setError(
            "This device or browser has WebGL disabled, so the map cannot render.",
          );
          setLoading(false);
          return;
        }

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

        const renderLimits = isMobile
          ? MOBILE_RENDER_LIMITS
          : DESKTOP_RENDER_LIMITS;

        const ctx = await engine.createMap({
          mapSelector: `#${DEEPSCATTER_ID}`,
          width: rect.width,
          height: rect.height,
          tilesUrl: `${base}/tiles`,
          labelsBase: `${SERVER_URL}/map/labels`,
          clusterMax: meta.cluster_max,
          levels: meta.levels,
          extent: meta.extent,
          countries,
          filterColumns: facetList.map((f) => f.key),
          backgroundColor: backgroundForTheme(themeRef.current),
          labelFont: GeistSans.style.fontFamily,
          serverUrl: SERVER_URL,
          // The engine owns the zoom→layer mapping; it tells us which layer the
          // points are colored/labeled by so the picker can list that same layer.
          onColorLevel: (level: string | null) => {
            void loadClusterLevel(level);
          },
          ...renderLimits,
        });
        if (destroyed) return;

        spRef.current = ctx.sp;
        ctxRef.current = {
          countries: ctx.countries,
          clusterColors: ctx.clusterColors,
          destroy: ctx.destroy,
        };
        if (colorByClustersRef.current) {
          engine.setColorByClusters(ctx.sp, true, ctx.clusterColors);
        }
        // A surviving selection filters on the layer it was made at (kept in
        // clusterLevelRef, which onColorLevel only moves while nothing is selected).
        if (
          selectedCountriesRef.current.length > 0 ||
          selectedClustersRef.current.length > 0
        ) {
          const level = clusterLevelRef.current;
          engine.applyFilters(ctx.sp, {
            countries: selectedCountriesRef.current,
            ...(level ? { [level]: selectedClustersRef.current } : {}),
          });
        }
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
      // Empty the whole holder, not just its canvases: deepscatter's bind() reuses an
      // existing div.deepscatter_container and appends a second set of containers into
      // it, then the renderer picks the *first* (stale, canvas-less) one → crash.
      document.getElementById(DEEPSCATTER_ID)?.replaceChildren();
      spRef.current = null;
    };
  }, [layoutReady, isMobile, mapSizeRevision, loadClusterLevel]);

  useEffect(() => {
    const sp = spRef.current;
    const engine = engineRef.current;
    if (!sp || !engine) return;
    engine.setBackgroundColor(sp, backgroundForTheme(resolvedTheme));
  }, [resolvedTheme]);

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

  const doSearch = useCallback(async () => {
    const sp = spRef.current;
    const engine = engineRef.current;
    if (!sp || !engine) return;
    const id = searchValue.trim();
    if (!id) return;
    setSearchStatus({ kind: "searching" });
    try {
      const found = await engine.runSearch(sp, id);
      if (found) {
        setSearchStatus({ kind: "found", text: found.accession });
        if (isMobile) setDrawerOpen(false);
        return;
      }

      const aliases = await fetchAliasCandidates(id);
      for (const alias of aliases) {
        const aliasFound = await engine.runSearch(sp, alias);
        if (aliasFound) {
          setSearchStatus({
            kind: "found",
            text: `${aliasFound.accession} (alias for ${id})`,
          });
          if (isMobile) setDrawerOpen(false);
          return;
        }
      }

      setSearchStatus({ kind: "not-found", text: id });
    } catch (err) {
      setSearchStatus({ kind: "error", text: (err as Error).message });
    }
  }, [isMobile, searchValue]);

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
    colorByClustersRef.current = value;
    const sp = spRef.current;
    const ctx = ctxRef.current;
    if (sp && ctx) {
      engineRef.current?.setColorByClusters(sp, value, ctx.clusterColors);
    }
    // Keep selected-cluster labels on their original layer regardless of whether
    // their point colors are currently enabled.
    if (selectedClustersRef.current.length > 0) {
      engineRef.current?.setClusterSelectionLevel(clusterLevelRef.current);
    }
  }, []);

  const onToggleCountry = useCallback(
    (country: string, checked: boolean) => {
      setSelectedCountries((prev) => {
        const next = checked
          ? [...prev, country]
          : prev.filter((c) => c !== country);
        applySelections(next, selectedClustersRef.current);
        return next;
      });
    },
    [applySelections],
  );

  const onToggleCluster = useCallback(
    (id: string, checked: boolean) => {
      setSelectedClusters((prev) => {
        const next = checked ? [...prev, id] : prev.filter((c) => c !== id);
        // Set the ref here, not just in its effect: the fly-to below fires zoom
        // events synchronously, and loadClusterLevel reads this ref to decide
        // whether the picker's layer is locked.
        selectedClustersRef.current = next;
        // A cluster id only has meaning in the layer where it was selected, so
        // keep its labels (and, when enabled, colors) fixed while it is selected.
        engineRef.current?.setClusterSelectionLevel(
          next.length > 0 ? clusterLevelRef.current : null,
        );
        applySelections(selectedCountriesRef.current, next);
        return next;
      });
    },
    [applySelections],
  );

  const clearClusters = useCallback(() => {
    setSelectedClusters([]);
    selectedClustersRef.current = [];
    engineRef.current?.setClusterSelectionLevel(null);
    applySelections(selectedCountriesRef.current, []);
    // Unlocked again — catch the picker up to wherever the zoom drifted to while
    // the selection held it in place.
    void loadClusterLevel(engineRef.current?.colorLevel() ?? null);
  }, [applySelections, loadClusterLevel]);

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

  const zoomIn = useCallback(() => {
    const sp = spRef.current;
    if (sp) engineRef.current?.zoomBy(sp, 0.6);
  }, []);
  const zoomOut = useCallback(() => {
    const sp = spRef.current;
    if (sp) engineRef.current?.zoomBy(sp, 1 / 0.6);
  }, []);
  const recenter = useCallback(() => {
    const sp = spRef.current;
    if (sp) engineRef.current?.resetView(sp);
  }, []);

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

  const visibleClusters = clusters.filter((c) =>
    c.label.toLowerCase().includes(clusterQuery.toLowerCase()),
  );

  return (
    <Flex
      height="100%"
      width="100%"
      style={{ height: "100%", overflow: "hidden", position: "relative" }}
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
          width: min(20rem, calc(100vw - 2rem));
          max-width: calc(100vw - 2rem);
          box-sizing: border-box;
          font-size: 1rem;
          text-align: left;
          white-space: normal;
          box-shadow: 0 4px 16px var(--black-a6);
        }
        @media (max-width: ${MOBILE_MAP_BREAKPOINT}px) {
          #${DEEPSCATTER_ID} .tooltip {
            margin-left: 0;
            width: min(18rem, calc(100vw - 1.5rem));
            max-width: calc(100vw - 1.5rem);
            font-size: 0.875rem;
            line-height: 1.45;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .seqout-map-drawer {
            transition: none !important;
          }
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
            cursor: "pointer",
          }}
        />
      )}

      {/* Mobile drawer toggle */}
      {isMobile && !drawerOpen && (
        <IconButton
          size="3"
          variant="soft"
          highContrast
          aria-label="Open map controls"
          onClick={() => setDrawerOpen(true)}
          style={{
            position: "absolute",
            top: "max(0.75rem, env(safe-area-inset-top))",
            left: "max(0.75rem, env(safe-area-inset-left))",
            width: 44,
            height: 44,
            zIndex: 25,
            boxShadow: "0 2px 8px var(--black-a6)",
          }}
        >
          <HamburgerMenuIcon />
        </IconButton>
      )}

      {/* Sidebar (drawer on mobile) */}
      <Box
        className="seqout-map-drawer"
        style={{
          width: isMobile ? "min(21rem, calc(100vw - 1rem))" : SIDEBAR_WIDTH,
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
                maxWidth: "calc(100vw - 1rem)",
                height: "100%",
                zIndex: 30,
                paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
                overscrollBehavior: "contain",
                WebkitOverflowScrolling: "touch",
                transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
                transition: "transform 0.22s cubic-bezier(0.25, 1, 0.5, 1)",
                boxShadow: drawerOpen ? "0 0 40px var(--black-a8)" : "none",
              }
            : {}),
        }}
      >
        {isMobile && (
          <Flex
            align="center"
            justify="between"
            px="3"
            py="2"
            style={{ borderBottom: "1px solid var(--gray-a4)" }}
          >
            <Text size="2" weight="medium">
              Map controls
            </Text>
            <IconButton
              size="3"
              variant="ghost"
              color="gray"
              aria-label="Close controls"
              onClick={() => setDrawerOpen(false)}
              style={{ width: 44, height: 44 }}
            >
              <Cross1Icon />
            </IconButton>
          </Flex>
        )}

        {/* Search */}
        <Flex p={isMobile ? "4" : "3"} direction="column" gap="2">
          <TextField.Root
            size={isMobile ? "3" : "2"}
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
            <Text
              as="p"
              size={isMobile ? "2" : "1"}
              color={statusColor[searchStatus.kind]}
              mt="1"
            >
              {statusText}
            </Text>
          )}
        </Flex>

        <Separator size="4" />
        <Flex p={isMobile ? "4" : "3"} direction="column" gap="2">
          <Flex
            align="center"
            justify="between"
            gap="2"
            style={{ minHeight: isMobile ? 44 : undefined }}
          >
            <Text size="2">Color by cluster</Text>
            <Switch
              size={isMobile ? "2" : "1"}
              checked={colorByClusters}
              onCheckedChange={onToggleColorByClusters}
            />
          </Flex>
          <Text size={isMobile ? "2" : "1"}>
            Clusters generated using{" "}
            <Link href="https://github.com/vtraag/leidenalg">Leiden</Link> on
            embeddings produced by{" "}
            <Link href="https://huggingface.co/codefuse-ai/F2LLM-v2-8B">
              F2LLM-v2-8B
            </Link>{" "}
            from the dataset metadata in the original embedding space. Cluster
            labels were generated using{" "}
            <Link href="https://huggingface.co/unsloth/Qwen3.6-27B-GGUF">
              Qwen 3.6 27B
            </Link>{" "}
            model.
          </Text>
        </Flex>
        {/* Country filter */}
        <Box
          p={isMobile ? "4" : "3"}
          style={{ display: "flex", flexDirection: "column" }}
        >
          <Flex align="center" justify="between" mb="2">
            <Flex align={"center"} gap={"2"}>
              <GlobeIcon />
              <Text size="2">Countries</Text>
            </Flex>
          </Flex>
          <TextField.Root
            size={isMobile ? "2" : "1"}
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
            style={{ maxHeight: isMobile ? "min(42dvh, 320px)" : 240 }}
          >
            <Flex direction="column" gap="1" pr="2">
              {visibleCountries.map((country) => (
                <Text
                  as="label"
                  size="2"
                  key={country}
                  style={{ cursor: "pointer", display: "block" }}
                >
                  <Flex
                    align="center"
                    gap="2"
                    style={{ minHeight: isMobile ? 44 : 28 }}
                  >
                    <Checkbox
                      size={isMobile ? "2" : "1"}
                      checked={selectedCountries.includes(country)}
                      onCheckedChange={(checked) =>
                        onToggleCountry(country, checked === true)
                      }
                    />
                    <Text size={isMobile ? "2" : "1"}>{country}</Text>
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
        <Box p={isMobile ? "4" : "3"}>
          <Separator size="4" mb="3" />
          <Tooltip content="Clear the browser cache and reload fresh map data from the server">
            <Button
              size={isMobile ? "3" : "2"}
              mb={"4"}
              variant="soft"
              onClick={onPurge}
              style={{ width: "100%", minHeight: isMobile ? 44 : undefined }}
            >
              <UpdateIcon /> Refresh data
            </Button>
          </Tooltip>
        </Box>
      </Box>

      {/* Map */}
      <Box
        ref={mapAreaRef}
        style={{ position: "relative", flex: 1, minWidth: 0, height: "100%" }}
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

        {/* Zoom / recenter controls */}
        {!loading && !error && (
          <Flex
            direction="column"
            style={{
              position: "absolute",
              top: isMobile
                ? "max(0.75rem, env(safe-area-inset-top))"
                : "0.75rem",
              right: "0.75rem",
              zIndex: 15,
              borderRadius: "var(--radius-3)",
              overflow: "hidden",
              background: "var(--color-panel-solid)",
              border: "1px solid var(--gray-a5)",
              boxShadow: "0 2px 8px var(--black-a6)",
            }}
          >
            <Tooltip content="Zoom in" side="left">
              <IconButton
                size={isMobile ? "3" : "2"}
                variant="ghost"
                color="gray"
                aria-label="Zoom in"
                onClick={zoomIn}
                style={{
                  margin: 0,
                  borderRadius: 0,
                  height: isMobile ? 44 : 36,
                }}
              >
                <PlusIcon />
              </IconButton>
            </Tooltip>
            <Separator size="4" />
            <Tooltip content="Zoom out" side="left">
              <IconButton
                size={isMobile ? "3" : "2"}
                variant="ghost"
                color="gray"
                aria-label="Zoom out"
                onClick={zoomOut}
                style={{
                  margin: 0,
                  borderRadius: 0,
                  height: isMobile ? 44 : 36,
                }}
              >
                <MinusIcon />
              </IconButton>
            </Tooltip>
            <Separator size="4" />
            <Tooltip content="Recenter" side="left">
              <IconButton
                size={isMobile ? "3" : "2"}
                variant="ghost"
                color="gray"
                aria-label="Recenter map"
                onClick={recenter}
                style={{
                  margin: 0,
                  borderRadius: 0,
                  height: isMobile ? 44 : 36,
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 15 15"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden
                >
                  <circle cx="7.5" cy="7.5" r="2" fill="currentColor" />
                  <path
                    d="M7.5 1v2M7.5 12v2M1 7.5h2M12 7.5h2"
                    stroke="currentColor"
                    strokeWidth="1.1"
                    strokeLinecap="round"
                  />
                </svg>
              </IconButton>
            </Tooltip>
          </Flex>
        )}

        {/* Cluster picker */}
        {!isMobile && !loading && !error && clusters.length > 0 && (
          <Card
            size="1"
            style={{
              position: "absolute",
              right: "0.75rem",
              bottom: "0.75rem",
              width: 260,
              zIndex: 15,
              background: "var(--color-panel-solid)",
            }}
          >
            <Flex direction="column" gap="2">
              <Flex align="center" justify="between" gap="2">
                <Flex align="center" gap="2">
                  <TokensIcon />
                  <Text size="2">Clusters</Text>
                  {clusterLevel && (
                    <Badge size="1" variant="soft" color="gray">
                      {clusterLevel.replace("cluster_l", "L")}
                    </Badge>
                  )}
                </Flex>
                <Flex align="center" gap="1">
                  {selectedClusters.length > 0 && (
                    <Button
                      size="1"
                      variant="ghost"
                      color="gray"
                      onClick={clearClusters}
                    >
                      Clear ({selectedClusters.length})
                    </Button>
                  )}
                  <Tooltip
                    content={
                      clusterCardExpanded
                        ? "Collapse clusters"
                        : "Expand clusters"
                    }
                  >
                    <IconButton
                      size="1"
                      variant="ghost"
                      color="gray"
                      aria-label={clusterCardExpanded ? "Collapse" : "Expand"}
                      aria-expanded={clusterCardExpanded}
                      onClick={() => setClusterCardExpanded((open) => !open)}
                    >
                      {clusterCardExpanded ? (
                        <ChevronDownIcon />
                      ) : (
                        <ChevronUpIcon />
                      )}
                    </IconButton>
                  </Tooltip>
                </Flex>
              </Flex>
              {clusterCardExpanded && (
                <TextField.Root
                  size="1"
                  value={clusterQuery}
                  placeholder="Search clusters"
                  onChange={(e) => setClusterQuery(e.target.value)}
                >
                  <TextField.Slot>
                    <MagnifyingGlassIcon height="12" width="12" />
                  </TextField.Slot>
                </TextField.Root>
              )}
              {clusterCardExpanded && (
                <ScrollArea
                  type="auto"
                  scrollbars="vertical"
                  style={{ height: 220 }}
                >
                  <Flex direction="column" gap="1" pr="2">
                    {visibleClusters.map((cluster) => (
                      <Text
                        as="label"
                        size="1"
                        key={cluster.id}
                        style={{ cursor: "pointer", display: "block" }}
                      >
                        <Flex align="center" gap="2" style={{ minHeight: 28 }}>
                          <Checkbox
                            size="1"
                            checked={selectedClusters.includes(cluster.id)}
                            onCheckedChange={(checked) =>
                              onToggleCluster(cluster.id, checked === true)
                            }
                          />
                          <Text size="1">{cluster.label}</Text>
                        </Flex>
                      </Text>
                    ))}
                    {visibleClusters.length === 0 && (
                      <Text size="1" color="gray">
                        No clusters match.
                      </Text>
                    )}
                  </Flex>
                </ScrollArea>
              )}
            </Flex>
          </Card>
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
                          <Flex align="center" gap="1">
                            <Text size="2" weight="bold">
                              {f.label}
                            </Text>
                            {f.key !== "organism" && (
                              <Tooltip content="Generated with an LLM-powered pipeline — may not be fully accurate.">
                                <InfoCircledIcon color="var(--gray-9)" />
                              </Tooltip>
                            )}
                          </Flex>
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
