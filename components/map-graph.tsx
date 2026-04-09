"use client";

import { SERVER_URL } from "@/utils/constants";
import { type PickingInfo, OrthographicView } from "@deck.gl/core";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import {
  CornersIcon,
  Cross1Icon,
  InfoCircledIcon,
  MagnifyingGlassIcon,
  SwitchIcon,
  UpdateIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@radix-ui/react-icons";
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  DropdownMenu,
  Flex,
  Heading,
  IconButton,
  Link,
  Popover,
  Progress,
  Separator,
  Spinner,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import isoCountries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";

isoCountries.registerLocale(enLocale);

type MapPoint = {
  accession: string;
  countries: string[];
  x: number;
  y: number;
};

type RenderPoint = MapPoint & {
  fillColor: [number, number, number, number];
};

type LoadingRenderPoint = {
  x: number;
  y: number;
  fillColor: [number, number, number, number];
};

type AccessionsRecord = {
  accession: string;
  countries: string[];
};

type ClusterRaw = {
  title: string;
  centroid: number[];
  num_points: number;
};

type ClusterPoint = {
  title: string;
  num_points: number;
  x: number;
  y: number;
};

type ProjectMetadata = {
  accession: string;
  title: string;
  description: string;
};

type ViewState = {
  target: [number, number, number];
  zoom: number;
};

type SelectedPoint = {
  accession: string;
  x: number;
  y: number;
};

type PointsChunkInfo = {
  loadedPoints: number;
  totalPoints: number | null;
};

type MapDataSource = "cache" | "network";

type MapCacheStatus = {
  hasCache: boolean;
  cachedAt: number | null;
};

type MapBinaryCacheRecord = {
  version: number;
  savedAt: number;
  pointsBuffer: ArrayBuffer;
  accessionsBuffer: ArrayBuffer;
};

type FetchMapDataOptions = {
  signal?: AbortSignal;
  onPointsChunk?: (
    points: Array<{ x: number; y: number }>,
    info: PointsChunkInfo,
  ) => void;
  forceNetwork?: boolean;
  onSourceResolved?: (source: MapDataSource) => void;
  onCacheStatus?: (status: MapCacheStatus) => void;
};

const POINT_COLOR_DARK: [number, number, number, number] = [97, 207, 196, 210];
const POINT_COLOR_LIGHT: [number, number, number, number] = [72, 136, 245, 210];
const CLUSTER_TEXT_COLOR_DARK: [number, number, number, number] = [
  255, 255, 255, 235,
];
const CLUSTER_TEXT_COLOR_LIGHT: [number, number, number, number] = [
  34, 41, 51, 235,
];
const MUTED_POINT_DARK: [number, number, number, number] = [111, 124, 139, 80];
const MUTED_POINT_LIGHT: [number, number, number, number] = [168, 176, 187, 90];

const MIN_ZOOM = -8;
const MAX_ZOOM = 22;
const CLUSTER_LABEL_MIN_ZOOM = 0.9;
const ZOOM_STEP = 0.45;
const LOADING_PREVIEW_MAX_POINTS = 140000;
const LOADING_PREVIEW_CHUNK_TARGET = 2200;
const LOADING_PREVIEW_FLUSH_MS = 120;
const POINTS_DECODE_BATCH_SIZE = 50000;
const MAP_CACHE_DB_NAME = "pysradb-map-cache";
const MAP_CACHE_STORE_NAME = "map-binaries";
const MAP_CACHE_ENTRY_KEY = "v1";
const MAP_CACHE_VERSION = 1;
const INITIAL_VIEW_STATE: ViewState = {
  target: [0, 0, 0],
  zoom: 0,
};

const ISO3_COUNTRY_CODE_PATTERN = /^[A-Z]{3}$/;

function normalizeCountry(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!ISO3_COUNTRY_CODE_PATTERN.test(normalized)) return "";
  return normalized;
}

function getCountryLabel(countryCode: string): string {
  return (
    isoCountries.getName(countryCode, "en", { select: "official" }) ?? countryCode
  );
}

function countryMatchesQuery(
  countryCode: string,
  countryLabel: string,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return (
    countryCode.toLowerCase().includes(normalizedQuery) ||
    countryLabel.toLowerCase().includes(normalizedQuery)
  );
}

function decodePoints(buffer: ArrayBuffer): Array<{ x: number; y: number }> {
  if (buffer.byteLength % 8 !== 0) {
    throw new Error("Invalid points.bin size. Expected 8 bytes per point.");
  }

  const view = new DataView(buffer);
  const count = buffer.byteLength / 8;
  const points = new Array<{ x: number; y: number }>(count);

  for (let i = 0; i < count; i += 1) {
    const offset = i * 8;
    points[i] = {
      x: view.getFloat32(offset, true),
      y: view.getFloat32(offset + 4, true),
    };
  }

  return points;
}

function decodePointsChunk(bytes: Uint8Array): Array<{ x: number; y: number }> {
  if (bytes.byteLength % 8 !== 0) {
    throw new Error(
      "Invalid points.bin chunk size. Expected 8 bytes per point.",
    );
  }

  const count = bytes.byteLength / 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const points = new Array<{ x: number; y: number }>(count);

  for (let i = 0; i < count; i += 1) {
    const offset = i * 8;
    points[i] = {
      x: view.getFloat32(offset, true),
      y: view.getFloat32(offset + 4, true),
    };
  }

  return points;
}

function sampleEvenly<T>(items: T[], targetCount: number): T[] {
  if (targetCount <= 0 || items.length === 0) {
    return [];
  }
  if (items.length <= targetCount) {
    return items;
  }

  const sampled = new Array<T>(targetCount);
  const step = items.length / targetCount;
  for (let i = 0; i < targetCount; i += 1) {
    sampled[i] = items[Math.floor(i * step)];
  }
  return sampled;
}

function mergeMapPoints(
  points: Array<{ x: number; y: number }>,
  accessionRecords: AccessionsRecord[],
): MapPoint[] {
  if (points.length !== accessionRecords.length) {
    throw new Error(
      `Data mismatch: points=${points.length}, accessions=${accessionRecords.length}`,
    );
  }

  return points.map((point, index) => ({
    accession: accessionRecords[index].accession,
    countries: accessionRecords[index].countries,
    x: point.x,
    y: point.y,
  }));
}

async function decodePointsProgressively(
  buffer: ArrayBuffer,
  onPointsChunk?: FetchMapDataOptions["onPointsChunk"],
): Promise<Array<{ x: number; y: number }>> {
  if (!onPointsChunk) {
    return decodePoints(buffer);
  }

  if (buffer.byteLength % 8 !== 0) {
    throw new Error("Invalid points.bin size. Expected 8 bytes per point.");
  }

  const totalPoints = buffer.byteLength / 8;
  const points = new Array<{ x: number; y: number }>(totalPoints);

  for (let start = 0; start < totalPoints; start += POINTS_DECODE_BATCH_SIZE) {
    const end = Math.min(totalPoints, start + POINTS_DECODE_BATCH_SIZE);
    const chunkByteOffset = start * 8;
    const chunkByteLength = (end - start) * 8;
    const chunkBytes = new Uint8Array(buffer, chunkByteOffset, chunkByteLength);
    const chunkPoints = decodePointsChunk(chunkBytes);

    for (let i = 0; i < chunkPoints.length; i += 1) {
      points[start + i] = chunkPoints[i];
    }

    onPointsChunk(chunkPoints, {
      loadedPoints: end,
      totalPoints,
    });

    if (end < totalPoints) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }

  return points;
}

function isMapBinaryCacheRecord(value: unknown): value is MapBinaryCacheRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<MapBinaryCacheRecord>;
  return (
    record.version === MAP_CACHE_VERSION &&
    typeof record.savedAt === "number" &&
    Number.isFinite(record.savedAt) &&
    record.pointsBuffer instanceof ArrayBuffer &&
    record.accessionsBuffer instanceof ArrayBuffer
  );
}

function openMapCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MAP_CACHE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MAP_CACHE_STORE_NAME)) {
        db.createObjectStore(MAP_CACHE_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open map cache."));
  });
}

async function readMapBinaryCache(): Promise<MapBinaryCacheRecord | null> {
  const db = await openMapCacheDb();
  if (!db) {
    return null;
  }

  try {
    const record = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(MAP_CACHE_STORE_NAME, "readonly");
      const store = tx.objectStore(MAP_CACHE_STORE_NAME);
      const request = store.get(MAP_CACHE_ENTRY_KEY);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to read map cache."));
      tx.onabort = () =>
        reject(tx.error ?? new Error("Reading map cache was aborted."));
    });

    return isMapBinaryCacheRecord(record) ? record : null;
  } finally {
    db.close();
  }
}

async function writeMapBinaryCache(
  record: MapBinaryCacheRecord,
): Promise<void> {
  const db = await openMapCacheDb();
  if (!db) {
    return;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MAP_CACHE_STORE_NAME, "readwrite");
      const store = tx.objectStore(MAP_CACHE_STORE_NAME);
      store.put(record, MAP_CACHE_ENTRY_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("Failed to write map cache."));
      tx.onabort = () =>
        reject(tx.error ?? new Error("Writing map cache was aborted."));
    });
  } finally {
    db.close();
  }
}

function decodeAccessions(buffer: ArrayBuffer): AccessionsRecord[] {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const records: AccessionsRecord[] = [];
  let offset = 0;

  while (offset < buffer.byteLength) {
    if (offset + 4 > buffer.byteLength) {
      throw new Error("Invalid accessions.bin accession header.");
    }

    const accessionLen = view.getUint32(offset, true);
    offset += 4;

    if (offset + accessionLen > buffer.byteLength) {
      throw new Error("Invalid accessions.bin accession payload.");
    }

    const accession = decoder.decode(
      new Uint8Array(buffer, offset, accessionLen),
    );
    offset += accessionLen;

    let countries: string[] = [];

    if (offset + 4 <= buffer.byteLength) {
      const countryCount = view.getUint32(offset, true);
      offset += 4;

      const parsedCountries: string[] = [];
      let complete = true;

      for (let i = 0; i < countryCount; i += 1) {
        if (offset + 4 > buffer.byteLength) {
          complete = false;
          break;
        }

        const countryLen = view.getUint32(offset, true);
        offset += 4;

        if (offset + countryLen > buffer.byteLength) {
          complete = false;
          break;
        }

        const country = decoder
          .decode(new Uint8Array(buffer, offset, countryLen))
          .trim();
        offset += countryLen;

        if (country.length > 0) {
          const normalizedCountry = normalizeCountry(country);
          if (normalizedCountry.length > 0) {
            parsedCountries.push(normalizedCountry);
          }
        }
      }

      countries = complete ? parsedCountries : [];
      if (!complete) {
        offset = buffer.byteLength;
      }
    }

    records.push({
      accession,
      countries,
    });
  }

  return records;
}

async function fetchMapData(
  options: FetchMapDataOptions = {},
): Promise<MapPoint[]> {
  const {
    signal,
    onPointsChunk,
    forceNetwork = false,
    onSourceResolved,
    onCacheStatus,
  } = options;

  if (!forceNetwork) {
    try {
      const cachedRecord = await readMapBinaryCache();
      if (cachedRecord) {
        onCacheStatus?.({
          hasCache: true,
          cachedAt: cachedRecord.savedAt,
        });
        onSourceResolved?.("cache");

        const [points, accessionRecords] = await Promise.all([
          decodePointsProgressively(cachedRecord.pointsBuffer, onPointsChunk),
          Promise.resolve(decodeAccessions(cachedRecord.accessionsBuffer)),
        ]);

        return mergeMapPoints(points, accessionRecords);
      }

      onCacheStatus?.({
        hasCache: false,
        cachedAt: null,
      });
    } catch {
      onCacheStatus?.({
        hasCache: false,
        cachedAt: null,
      });
    }
  }

  onSourceResolved?.("network");
  const [pointsRes, accessionsRes] = await Promise.all([
    fetch(`${SERVER_URL}/points.bin`, { signal }),
    fetch(`${SERVER_URL}/accessions.bin`, { signal }),
  ]);

  if (!pointsRes.ok || !accessionsRes.ok) {
    throw new Error("Failed to fetch map binaries.");
  }

  const pointsBufferPromise = (async (): Promise<ArrayBuffer> => {
    const totalBytesHeader = pointsRes.headers.get("content-length");
    const parsedTotalBytes = totalBytesHeader
      ? Number.parseInt(totalBytesHeader, 10)
      : Number.NaN;
    const totalPoints =
      Number.isFinite(parsedTotalBytes) &&
      parsedTotalBytes > 0 &&
      parsedTotalBytes % 8 === 0
        ? parsedTotalBytes / 8
        : null;

    const streamReader = pointsRes.body?.getReader();
    if (!streamReader) {
      const fallbackBuffer = await pointsRes.arrayBuffer();
      const fallbackPoints = decodePoints(fallbackBuffer);
      onPointsChunk?.(fallbackPoints, {
        loadedPoints: fallbackPoints.length,
        totalPoints,
      });
      return fallbackBuffer;
    }

    const chunks: Uint8Array[] = [];
    let loadedBytes = 0;
    let loadedPoints = 0;
    let remainder = new Uint8Array(0);

    while (true) {
      const { done, value } = await streamReader.read();
      if (done) {
        break;
      }

      if (!value || value.byteLength === 0) {
        continue;
      }

      chunks.push(value);
      loadedBytes += value.byteLength;

      const merged = new Uint8Array(remainder.byteLength + value.byteLength);
      merged.set(remainder, 0);
      merged.set(value, remainder.byteLength);

      const completeByteLength = merged.byteLength - (merged.byteLength % 8);
      if (completeByteLength > 0) {
        const completeSlice = merged.subarray(0, completeByteLength);
        const chunkPoints = decodePointsChunk(completeSlice);
        loadedPoints += chunkPoints.length;
        onPointsChunk?.(chunkPoints, { loadedPoints, totalPoints });
      }

      remainder = merged.subarray(completeByteLength);
    }

    if (remainder.byteLength !== 0) {
      throw new Error("Invalid points.bin size. Expected 8 bytes per point.");
    }

    const reconstructed = new Uint8Array(loadedBytes);
    let writeOffset = 0;
    for (const chunk of chunks) {
      reconstructed.set(chunk, writeOffset);
      writeOffset += chunk.byteLength;
    }

    if (writeOffset !== loadedBytes) {
      throw new Error("Failed to reconstruct points.bin stream.");
    }

    if (reconstructed.byteLength % 8 !== 0) {
      throw new Error("Invalid points.bin size. Expected 8 bytes per point.");
    }

    return reconstructed.buffer;
  })();

  const [pointsBuffer, accessionsBuffer] = await Promise.all([
    pointsBufferPromise,
    accessionsRes.arrayBuffer(),
  ]);

  const points = decodePoints(pointsBuffer);
  const accessionRecords = decodeAccessions(accessionsBuffer);

  const savedAt = Date.now();
  onCacheStatus?.({
    hasCache: true,
    cachedAt: savedAt,
  });

  void writeMapBinaryCache({
    version: MAP_CACHE_VERSION,
    savedAt,
    pointsBuffer: pointsBuffer.slice(0),
    accessionsBuffer: accessionsBuffer.slice(0),
  }).catch(() => {});

  return mergeMapPoints(points, accessionRecords);
}

async function fetchClusters(): Promise<ClusterRaw[]> {
  const response = await fetch(`${SERVER_URL}/clusters.json`);
  if (!response.ok) {
    throw new Error("Failed to fetch clusters.");
  }

  return response.json() as Promise<ClusterRaw[]>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatRelativeAge(timestamp: number): string {
  const now = new Date();
  const cachedAt = new Date(timestamp);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfCachedDay = new Date(cachedAt);
  startOfCachedDay.setHours(0, 0, 0, 0);

  const dayDiff = Math.floor(
    (startOfToday.getTime() - startOfCachedDay.getTime()) /
      (24 * 60 * 60 * 1000),
  );

  if (dayDiff <= 0) {
    const hours = Math.max(
      1,
      Math.floor((now.getTime() - cachedAt.getTime()) / (60 * 60 * 1000)),
    );
    return `Cached ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  if (dayDiff === 1) {
    return "Cached yesterday";
  }

  return `Cached ${dayDiff} days ago`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;

  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const m = l - c / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.trim().toLowerCase();
  const fullHex =
    normalized.length === 4
      ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
      : normalized;

  if (!/^#[0-9a-f]{6}$/.test(fullHex)) {
    return [0, 0, 0];
  }

  return [
    parseInt(fullHex.slice(1, 3), 16),
    parseInt(fullHex.slice(3, 5), 16),
    parseInt(fullHex.slice(5, 7), 16),
  ];
}

function deterministicCountryColor(country: string): string {
  let hash = 0;
  for (let i = 0; i < country.length; i += 1) {
    hash = (hash * 31 + country.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const [r, g, b] = hslToRgb(hue, 0.78, 0.56);
  return rgbToHex(r, g, b);
}

async function fetchProjectMetadata(
  accession: string,
): Promise<ProjectMetadata> {
  const response = await fetch(
    `${SERVER_URL}/project/${encodeURIComponent(accession)}/metadata`,
  );
  if (!response.ok) {
    throw new Error("Failed to fetch project metadata.");
  }

  return response.json() as Promise<ProjectMetadata>;
}

export default function MapGraph() {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const loadingPreviewBufferRef = useRef<Array<{ x: number; y: number }>>([]);
  const loadingPreviewFlushRef = useRef(0);
  const forceNetworkFetchRef = useRef(false);
  const [viewState, setViewState] = useState<ViewState>(INITIAL_VIEW_STATE);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });

  const [searchInput, setSearchInput] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [countrySearchInput, setCountrySearchInput] = useState("");
  const [colorByClusters, setColorByClusters] = useState(false);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [countryColors, setCountryColors] = useState<Record<string, string>>(
    {},
  );

  const [highlightedPoint, setHighlightedPoint] = useState<MapPoint | null>(
    null,
  );
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint | null>(
    null,
  );
  const [loadingPreviewPoints, setLoadingPreviewPoints] = useState<
    Array<{ x: number; y: number }>
  >([]);
  const [loadingProgress, setLoadingProgress] = useState<PointsChunkInfo>({
    loadedPoints: 0,
    totalPoints: null,
  });
  const [mapDataSource, setMapDataSource] = useState<MapDataSource | null>(
    null,
  );
  const [cacheStatus, setCacheStatus] = useState<MapCacheStatus>({
    hasCache: false,
    cachedAt: null,
  });
  const [isFetchingFreshMap, setIsFetchingFreshMap] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const { clientWidth, clientHeight } = container;
      setViewportSize({ width: clientWidth, height: clientHeight });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateWindowSize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    updateWindowSize();
    window.addEventListener("resize", updateWindowSize);
    return () => window.removeEventListener("resize", updateWindowSize);
  }, []);

  const dataQuery = useQuery({
    queryKey: ["map-binaries"],
    queryFn: ({ signal }) => {
      const forceNetwork = forceNetworkFetchRef.current;
      forceNetworkFetchRef.current = false;

      loadingPreviewBufferRef.current = [];
      loadingPreviewFlushRef.current = 0;
      setMapDataSource(null);
      setLoadingPreviewPoints([]);
      setLoadingProgress({
        loadedPoints: 0,
        totalPoints: null,
      });

      return fetchMapData({
        signal,
        forceNetwork,
        onSourceResolved: setMapDataSource,
        onCacheStatus: setCacheStatus,
        onPointsChunk: (chunkPoints, info) => {
          const previewBuffer = loadingPreviewBufferRef.current;
          const remainingCapacity =
            LOADING_PREVIEW_MAX_POINTS - previewBuffer.length;

          if (chunkPoints.length > 0 && remainingCapacity > 0) {
            const sampleTarget = Math.min(
              remainingCapacity,
              LOADING_PREVIEW_CHUNK_TARGET,
            );
            const sampledChunk = sampleEvenly(chunkPoints, sampleTarget);
            for (const point of sampledChunk) {
              previewBuffer.push(point);
            }
          }

          setLoadingProgress((previous) => {
            if (
              previous.loadedPoints === info.loadedPoints &&
              previous.totalPoints === info.totalPoints
            ) {
              return previous;
            }
            return info;
          });

          const now = performance.now();
          const reachedTotal =
            info.totalPoints !== null && info.loadedPoints >= info.totalPoints;
          if (
            now - loadingPreviewFlushRef.current >= LOADING_PREVIEW_FLUSH_MS ||
            reachedTotal
          ) {
            loadingPreviewFlushRef.current = now;
            setLoadingPreviewPoints([...previewBuffer]);
          }
        },
      });
    },
    retry: 2,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const clusterQuery = useQuery({
    queryKey: ["map-clusters"],
    queryFn: fetchClusters,
    retry: 2,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const metadataQuery = useQuery({
    queryKey: ["point-metadata", selectedPoint?.accession],
    enabled: Boolean(selectedPoint?.accession),
    queryFn: () => fetchProjectMetadata(selectedPoint!.accession),
    staleTime: 30 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const normalization = useMemo(() => {
    const raw = dataQuery.data;
    if (!raw || raw.length === 0) {
      return null;
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const point of raw) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }

    return {
      minX,
      maxX,
      minY,
      maxY,
      xSpan: maxX - minX || 1,
      ySpan: maxY - minY || 1,
    };
  }, [dataQuery.data]);

  const points = useMemo<MapPoint[]>(() => {
    const raw = dataQuery.data;
    if (!raw || !normalization) {
      return [];
    }

    const extent = 2200;
    return raw.map((point) => ({
      accession: point.accession,
      countries: point.countries,
      x: ((point.x - normalization.minX) / normalization.xSpan - 0.5) * extent,
      y: ((point.y - normalization.minY) / normalization.ySpan - 0.5) * extent,
    }));
  }, [dataQuery.data, normalization]);

  const clusters = useMemo<ClusterPoint[]>(() => {
    const rawClusters = clusterQuery.data;
    if (!rawClusters || !normalization) {
      return [];
    }

    const extent = 2200;
    return rawClusters
      .filter(
        (cluster) =>
          Array.isArray(cluster.centroid) &&
          cluster.centroid.length >= 2 &&
          typeof cluster.centroid[0] === "number" &&
          typeof cluster.centroid[1] === "number" &&
          Number.isFinite(cluster.centroid[0]) &&
          Number.isFinite(cluster.centroid[1]) &&
          typeof cluster.num_points === "number" &&
          Number.isFinite(cluster.num_points) &&
          cluster.num_points > 0 &&
          typeof cluster.title === "string" &&
          cluster.title.length > 0,
      )
      .map((cluster) => ({
        title: cluster.title,
        num_points: cluster.num_points,
        x:
          ((cluster.centroid[0] - normalization.minX) / normalization.xSpan -
            0.5) *
          extent,
        y:
          ((cluster.centroid[1] - normalization.minY) / normalization.ySpan -
            0.5) *
          extent,
      }))
      .sort((a, b) => b.num_points - a.num_points);
  }, [clusterQuery.data, normalization]);

  const visibleClusters = useMemo(() => {
    if (viewState.zoom < CLUSTER_LABEL_MIN_ZOOM) {
      return [];
    }

    if (clusters.length === 0) {
      return [];
    }

    const zoomProgress = clamp(
      (viewState.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM),
      0,
      1,
    );
    const visibleFraction = 0.02 + 0.98 * Math.pow(zoomProgress, 1.7);
    const visibleCount = Math.max(
      1,
      Math.ceil(clusters.length * visibleFraction),
    );
    const candidates = clusters.slice(0, visibleCount);

    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return candidates;
    }

    const scale = 2 ** viewState.zoom;
    const baseCellSize = 150;
    const cellSize = clamp(baseCellSize - viewState.zoom * 6, 48, 170);
    const chosenByCell = new Map<string, ClusterPoint>();

    for (const cluster of candidates) {
      const sx =
        (cluster.x - viewState.target[0]) * scale + viewportSize.width / 2;
      const sy =
        viewportSize.height / 2 - (cluster.y - viewState.target[1]) * scale;

      if (sx < -24 || sx > viewportSize.width + 24) continue;
      if (sy < -24 || sy > viewportSize.height + 24) continue;

      const cellX = Math.floor(sx / cellSize);
      const cellY = Math.floor(sy / cellSize);
      const key = `${cellX}:${cellY}`;

      if (!chosenByCell.has(key)) {
        chosenByCell.set(key, cluster);
      }
    }

    return Array.from(chosenByCell.values())
      .sort((a, b) => b.num_points - a.num_points)
      .slice(0, 10);
  }, [
    clusters,
    viewState.zoom,
    viewState.target,
    viewportSize.width,
    viewportSize.height,
  ]);

  const countryStats = useMemo(() => {
    const counts = new Map<string, number>();

    for (const point of points) {
      const uniqueCountries = new Set(
        point.countries.map((country) => country.trim()).filter(Boolean),
      );

      for (const country of uniqueCountries) {
        counts.set(country, (counts.get(country) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({
        code,
        label: getCountryLabel(code),
        count,
      }));
  }, [points]);

  const defaultCountryColors = useMemo(() => {
    const colorMap: Record<string, string> = {};
    for (const option of countryStats) {
      colorMap[option.code] = deterministicCountryColor(option.code);
    }
    return colorMap;
  }, [countryStats]);

  const filteredCountryStats = useMemo(() => {
    const query = countrySearchInput.trim().toLowerCase();
    if (!query) return countryStats;
    return countryStats.filter(({ code, label }) =>
      countryMatchesQuery(code, label, query),
    );
  }, [countryStats, countrySearchInput]);

  const pointsByAccession = useMemo(() => {
    const lookup = new Map<string, MapPoint>();
    for (const point of points) {
      lookup.set(point.accession.toLowerCase(), point);
    }
    return lookup;
  }, [points]);

  const pointColor =
    resolvedTheme === "light" ? POINT_COLOR_LIGHT : POINT_COLOR_DARK;
  const mutedPointColor =
    resolvedTheme === "light" ? MUTED_POINT_LIGHT : MUTED_POINT_DARK;
  const clusterTextColor =
    resolvedTheme === "light"
      ? CLUSTER_TEXT_COLOR_LIGHT
      : CLUSTER_TEXT_COLOR_DARK;
  const loadingPointAlpha = resolvedTheme === "light" ? 95 : 120;

  const loadingRenderPoints = useMemo<LoadingRenderPoint[]>(() => {
    if (loadingPreviewPoints.length === 0) {
      return [];
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const point of loadingPreviewPoints) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }

    const xSpan = maxX - minX || 1;
    const ySpan = maxY - minY || 1;
    const extent = 2200;

    return loadingPreviewPoints.map((point) => ({
      x: ((point.x - minX) / xSpan - 0.5) * extent,
      y: ((point.y - minY) / ySpan - 0.5) * extent,
      fillColor: [
        pointColor[0],
        pointColor[1],
        pointColor[2],
        loadingPointAlpha,
      ],
    }));
  }, [loadingPreviewPoints, pointColor, loadingPointAlpha]);

  const renderPoints = useMemo<RenderPoint[]>(() => {
    if (selectedCountries.length > 0) {
      return points.map((point) => {
        const matchedCountry = selectedCountries.find((country) =>
          point.countries.includes(country),
        );

        if (!matchedCountry) {
          return { ...point, fillColor: mutedPointColor };
        }

        const [r, g, b] = hexToRgb(
          countryColors[matchedCountry] ?? defaultCountryColors[matchedCountry],
        );

        return { ...point, fillColor: [r, g, b, 235] };
      });
    }

    if (!colorByClusters || clusters.length === 0) {
      return points.map((point) => ({ ...point, fillColor: pointColor }));
    }

    const topClusters = clusters.slice(0, 32);
    const maxNumPoints = topClusters[0]?.num_points ?? 1;
    const minRadius = 120;
    const maxRadius = 700;

    const clusterStyles = topClusters.map((cluster, idx) => {
      const hue = (idx * 137.5) % 360;
      const [r, g, b] = hslToRgb(
        hue,
        0.8,
        resolvedTheme === "light" ? 0.52 : 0.58,
      );
      const radiusNorm = Math.sqrt(cluster.num_points / maxNumPoints);
      const radius = minRadius + (maxRadius - minRadius) * radiusNorm;
      return {
        ...cluster,
        color: [r, g, b] as [number, number, number],
        radius,
      };
    });

    return points.map((point) => {
      let bestScore = 0;
      let bestColor: [number, number, number] | null = null;

      for (const cluster of clusterStyles) {
        const dx = point.x - cluster.x;
        const dy = point.y - cluster.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > cluster.radius) continue;

        const score = 1 - dist / cluster.radius;
        if (score > bestScore) {
          bestScore = score;
          bestColor = cluster.color;
        }
      }

      if (!bestColor || bestScore <= 0) {
        return { ...point, fillColor: pointColor };
      }

      const blend = clamp(bestScore * 0.9, 0.2, 0.9);
      const color: [number, number, number, number] = [
        Math.round(pointColor[0] * (1 - blend) + bestColor[0] * blend),
        Math.round(pointColor[1] * (1 - blend) + bestColor[1] * blend),
        Math.round(pointColor[2] * (1 - blend) + bestColor[2] * blend),
        pointColor[3],
      ];

      return { ...point, fillColor: color };
    });
  }, [
    selectedCountries,
    points,
    mutedPointColor,
    countryColors,
    defaultCountryColors,
    colorByClusters,
    clusters,
    pointColor,
    resolvedTheme,
  ]);

  const layers = useMemo(() => {
    const pointLayer = new ScatterplotLayer<RenderPoint | LoadingRenderPoint>({
      id: "map-points",
      data: dataQuery.isLoading ? loadingRenderPoints : renderPoints,
      pickable: !dataQuery.isLoading,
      getPosition: (d) => [d.x, d.y],
      getFillColor: (d) => d.fillColor,
      getRadius: 0.4,
      radiusUnits: "pixels",
      radiusMinPixels: 0.2,
      radiusMaxPixels: 1.4,
      stroked: false,
      onClick: (info: PickingInfo<RenderPoint | LoadingRenderPoint>) => {
        if (dataQuery.isLoading || !info.object) {
          return;
        }

        if (
          !("accession" in info.object) ||
          !Array.isArray(info.object.countries)
        ) {
          return;
        }

        const srcEvent = (
          info as PickingInfo<RenderPoint | LoadingRenderPoint> & {
            srcEvent?: Event;
          }
        ).srcEvent;
        const clickX =
          srcEvent && "clientX" in srcEvent
            ? (srcEvent as MouseEvent).clientX
            : Number.isFinite(info.x)
              ? info.x
              : windowSize.width / 2;
        const clickY =
          srcEvent && "clientY" in srcEvent
            ? (srcEvent as MouseEvent).clientY
            : Number.isFinite(info.y)
              ? info.y
              : windowSize.height / 2;

        const clickedPoint = info.object as RenderPoint;
        setSelectedPoint({
          accession: clickedPoint.accession,
          x: clickX,
          y: clickY,
        });
        setHighlightedPoint({
          accession: clickedPoint.accession,
          countries: clickedPoint.countries,
          x: clickedPoint.x,
          y: clickedPoint.y,
        });
      },
    });

    if (dataQuery.isLoading) {
      return [pointLayer];
    }

    return [
      pointLayer,
      new ScatterplotLayer<MapPoint>({
        id: "map-highlight-point",
        data: highlightedPoint ? [highlightedPoint] : [],
        pickable: false,
        getPosition: (d) => [d.x, d.y],
        getFillColor: [255, 92, 71, 255],
        getRadius: 0.9,
        radiusUnits: "pixels",
        radiusMinPixels: 1,
        radiusMaxPixels: 1.6,
        stroked: true,
        getLineColor: [255, 255, 255, 220],
        lineWidthMinPixels: 0.5,
      }),
      new TextLayer<ClusterPoint>({
        id: "map-cluster-labels",
        data: visibleClusters,
        pickable: false,
        getPosition: (d) => [d.x, d.y],
        getText: (d) => d.title,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        getSize: 12,
        getColor: clusterTextColor,
        fontWeight: 700,
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        getPixelOffset: [0, -8],
      }),
    ];
  }, [
    dataQuery.isLoading,
    loadingRenderPoints,
    renderPoints,
    windowSize.width,
    windowSize.height,
    highlightedPoint,
    visibleClusters,
    clusterTextColor,
  ]);

  const metadataCardPosition = useMemo(() => {
    if (!selectedPoint) {
      return null;
    }

    const cardWidth = 360;
    const cardHeight = 240;
    const margin = 12;
    const maxLeft = Math.max(margin, windowSize.width - cardWidth - margin);
    const maxTop = Math.max(margin, windowSize.height - cardHeight - margin);

    return {
      left: clamp(selectedPoint.x + 24, margin, maxLeft),
      top: clamp(selectedPoint.y + 14, margin, maxTop),
      width: cardWidth,
    };
  }, [selectedPoint, windowSize.width, windowSize.height]);

  if (dataQuery.isError) {
    return (
      <Flex align="center" justify="center" style={{ height: "100%" }}>
        <Text size={{ initial: "2", md: "3" }} color="red">
          {(dataQuery.error as Error).message}
        </Text>
      </Flex>
    );
  }

  const isMapLoading = dataQuery.isLoading;
  const progressPercent =
    loadingProgress.totalPoints && loadingProgress.totalPoints > 0
      ? Math.round(
          clamp(
            loadingProgress.loadedPoints / loadingProgress.totalPoints,
            0,
            1,
          ) * 100,
        )
      : null;
  const loadingSourceText =
    mapDataSource === "cache"
      ? "Using cached map from browser storage."
      : mapDataSource === "network"
        ? "Fetching the latest map from server."
        : "Preparing map data source...";
  const cacheAgeText =
    cacheStatus.hasCache && cacheStatus.cachedAt
      ? formatRelativeAge(cacheStatus.cachedAt)
      : "No cached map found on this browser yet.";
  const mapSourceBadge =
    mapDataSource === "cache"
      ? { label: "Viewing cached", color: "green" as const }
      : mapDataSource === "network"
        ? { label: "Viewing fresh", color: "blue" as const }
        : null;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchInput.trim().toLowerCase();
    if (!query) {
      return;
    }

    const targetPoint = pointsByAccession.get(query);
    if (!targetPoint) {
      setSearchError("Accession not found.");
      return;
    }

    setSearchError(null);
    setHighlightedPoint(targetPoint);
    setViewState((prev) => ({
      ...prev,
      target: [targetPoint.x, targetPoint.y, 0],
      zoom: Math.max(prev.zoom, 6),
    }));
  };

  const toggleCountrySelection = (country: string, checked: boolean) => {
    setSelectedCountries((prev) => {
      if (checked) {
        if (prev.includes(country)) return prev;
        return [...prev, country];
      }
      return prev.filter((item) => item !== country);
    });
  };

  const handleFetchFreshMap = async () => {
    if (dataQuery.isFetching || isFetchingFreshMap) {
      return;
    }

    forceNetworkFetchRef.current = true;
    setIsFetchingFreshMap(true);
    try {
      await dataQuery.refetch({ cancelRefetch: true });
    } finally {
      setIsFetchingFreshMap(false);
    }
  };

  return (
    <Box ref={containerRef} style={{ height: "100%", position: "relative" }}>
      {!isMapLoading && (
        <Box style={{ position: "absolute", top: 12, left: 12, zIndex: 22 }}>
          <Card size={{ initial: "1", md: "2" }}>
            <form onSubmit={handleSearchSubmit}>
              <Flex direction="column" gap="2">
                <Flex gap="2" align="center">
                  <TextField.Root
                    placeholder="Search accession"
                    value={searchInput}
                    size={{ initial: "1", md: "2" }}
                    onChange={(event) => {
                      setSearchInput(event.target.value);
                      if (searchError) setSearchError(null);
                    }}
                  />
                  <IconButton
                    type="submit"
                    variant="soft"
                    size={{ initial: "2", md: "2" }}
                    aria-label="Search accession"
                  >
                    <MagnifyingGlassIcon />
                  </IconButton>
                </Flex>
                {searchError && (
                  <Text size={{ initial: "1", md: "2" }} color="red">
                    {searchError}
                  </Text>
                )}
              </Flex>
            </form>
          </Card>
        </Box>
      )}

      {!isMapLoading && (
        <Box
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 23,
          }}
        >
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button variant="solid" size={{ initial: "2", md: "2" }}>
                <SwitchIcon />
                Configure
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              style={{ width: "min(92vw, 340px)", maxHeight: "72vh" }}
            >
              <Flex direction="column" gap="2">
                <Flex align="center" gap="2">
                  <Checkbox
                    id="cluster-color-toggle"
                    size={{ initial: "1", md: "2" }}
                    checked={colorByClusters}
                    onCheckedChange={(checked) =>
                      setColorByClusters(Boolean(checked))
                    }
                  />
                  <Text
                    as="label"
                    htmlFor="cluster-color-toggle"
                    size={{ initial: "1", md: "2" }}
                  >
                    Color by clusters
                  </Text>
                </Flex>

                <Box style={{ height: 1, backgroundColor: "var(--gray-a4)" }} />

                <TextField.Root
                  placeholder="Search countries"
                  size={{ initial: "1", md: "2" }}
                  value={countrySearchInput}
                  onChange={(event) =>
                    setCountrySearchInput(event.target.value)
                  }
                />

                <Box
                  style={{
                    maxHeight: "34vh",
                    overflowY: "auto",
                    paddingRight: 4,
                  }}
                >
                  <Flex direction="column" gap="1">
                    {countryStats.length === 0 && (
                      <Text size={{ initial: "1", md: "2" }} color="gray">
                        No country metadata available.
                      </Text>
                    )}
                    {countryStats.length > 0 &&
                      filteredCountryStats.length === 0 && (
                        <Text size={{ initial: "1", md: "2" }} color="gray">
                          No countries match your search.
                        </Text>
                      )}

                    {filteredCountryStats.map(({ code, label }, index) => {
                      const checked = selectedCountries.includes(code);
                      const checkboxId = `country-filter-${index}`;
                      const colorValue =
                        countryColors[code] ?? defaultCountryColors[code];

                      return (
                        <Flex
                          key={code}
                          align="center"
                          justify="between"
                          gap="2"
                        >
                          <Flex
                            align="center"
                            gap="2"
                            style={{ minWidth: 0, flex: 1 }}
                          >
                            <Checkbox
                              id={checkboxId}
                              checked={checked}
                              onCheckedChange={(value) =>
                                toggleCountrySelection(code, Boolean(value))
                              }
                            />
                            <Text
                              as="label"
                              htmlFor={checkboxId}
                              size={{ initial: "1", md: "2" }}
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                cursor: "pointer",
                                flex: 1,
                              }}
                            >
                              {label}
                            </Text>
                          </Flex>
                          <input
                            type="color"
                            aria-label={`Color for ${label}`}
                            value={colorValue}
                            onChange={(event) =>
                              setCountryColors((prev) => ({
                                ...prev,
                                [code]: event.target.value,
                              }))
                            }
                            style={{
                              width: 26,
                              height: 18,
                              border: "none",
                              background: "transparent",
                              padding: 0,
                              cursor: "pointer",
                            }}
                          />
                        </Flex>
                      );
                    })}
                  </Flex>
                </Box>

                {selectedCountries.length > 0 && (
                  <Text
                    size="1"
                    color="gray"
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelectedCountries([])}
                  >
                    Clear selected countries
                  </Text>
                )}
              </Flex>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Box>
      )}

      {!isMapLoading && (
        <Box style={{ position: "absolute", left: 12, bottom: 24, zIndex: 20 }}>
          <Popover.Root>
            <Popover.Trigger>
              <IconButton
                variant="soft"
                size={{ initial: "2", md: "2" }}
                aria-label="Open map cache settings"
              >
                <InfoCircledIcon />
              </IconButton>
            </Popover.Trigger>
            <Popover.Content
              side="top"
              align="start"
              sideOffset={8}
              size="2"
              style={{ width: "min(92vw, 300px)" }}
            >
              <Flex direction="column" gap="2">
                <Flex align="center" justify="between" gap="2">
                  <Text size={{ initial: "1", md: "2" }} weight="medium">
                    Map cache
                  </Text>
                  {mapSourceBadge && (
                    <Badge size="1" color={mapSourceBadge.color} variant="soft">
                      {mapSourceBadge.label}
                    </Badge>
                  )}
                </Flex>

                <Text size="1" color="gray">
                  Maps are seldom changed, so fetching a fresh version is
                  usually not necessary.
                </Text>

                <Separator size="4" />

                <Text size="1" color="gray">
                  {cacheAgeText}
                </Text>

                <Button
                  variant="soft"
                  size="1"
                  onClick={() => {
                    void handleFetchFreshMap();
                  }}
                  disabled={isFetchingFreshMap || dataQuery.isFetching}
                >
                  {isFetchingFreshMap ? <Spinner size="1" /> : <UpdateIcon />}
                  {isFetchingFreshMap ? "Fetching..." : "Fetch fresh version"}
                </Button>
              </Flex>
            </Popover.Content>
          </Popover.Root>
        </Box>
      )}

      {!isMapLoading && (
        <Box
          style={{ position: "absolute", right: 12, bottom: 24, zIndex: 20 }}
        >
          <Card size={{ initial: "1", md: "2" }}>
            <Flex gap="2" direction="column" align="center">
              <Tooltip content="Zoom in" side="left">
                <IconButton
                  variant="soft"
                  size={{ initial: "2", md: "2" }}
                  aria-label="Zoom in"
                  onClick={() =>
                    setViewState((prev) => ({
                      ...prev,
                      zoom: Math.min(prev.zoom + ZOOM_STEP, MAX_ZOOM),
                    }))
                  }
                >
                  <ZoomInIcon />
                </IconButton>
              </Tooltip>
              <Tooltip content="Zoom out" side="left">
                <IconButton
                  variant="soft"
                  size={{ initial: "2", md: "2" }}
                  aria-label="Zoom out"
                  onClick={() =>
                    setViewState((prev) => ({
                      ...prev,
                      zoom: Math.max(prev.zoom - ZOOM_STEP, MIN_ZOOM),
                    }))
                  }
                >
                  <ZoomOutIcon />
                </IconButton>
              </Tooltip>
              <Tooltip content="Reset view" side="left">
                <IconButton
                  variant="soft"
                  size={{ initial: "2", md: "2" }}
                  aria-label="Reset zoom"
                  onClick={() => setViewState(INITIAL_VIEW_STATE)}
                >
                  <CornersIcon />
                </IconButton>
              </Tooltip>
            </Flex>
          </Card>
        </Box>
      )}

      {!isMapLoading && selectedPoint && metadataCardPosition && (
        <Box
          style={{
            position: "fixed",
            left: metadataCardPosition.left,
            top: metadataCardPosition.top,
            width: metadataCardPosition.width,
            maxWidth: "min(90vw, 360px)",
            zIndex: 25,
          }}
        >
          <Card size={{ initial: "1", md: "2" }}>
            <Flex direction="column" gap="2">
              <Flex align="center" justify="between" gap="2">
                <Text
                  size={{ initial: "1", md: "2" }}
                  color="gray"
                  style={{ overflowWrap: "anywhere" }}
                >
                  {metadataQuery.data?.accession || selectedPoint.accession}
                </Text>
                <IconButton
                  variant="ghost"
                  size={{ initial: "1", md: "2" }}
                  aria-label="Close metadata card"
                  onClick={() => setSelectedPoint(null)}
                >
                  <Cross1Icon />
                </IconButton>
              </Flex>

              {metadataQuery.isLoading && (
                <Text size={{ initial: "2", md: "3" }} color="gray">
                  Loading metadata...
                </Text>
              )}

              {metadataQuery.isError && (
                <Text size={{ initial: "2", md: "3" }} color="red">
                  {(metadataQuery.error as Error).message}
                </Text>
              )}

              {metadataQuery.data && (
                <>
                  <Link
                    href={`/p/${encodeURIComponent(
                      metadataQuery.data.accession || selectedPoint.accession,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: "none" }}
                  >
                    <Text size={{ initial: "2", md: "3" }} weight="bold">
                      {metadataQuery.data.title || "Untitled"}
                    </Text>
                  </Link>
                  <Text size={{ initial: "1", md: "2" }} color="gray">
                    {metadataQuery.data.description
                      ? truncateText(metadataQuery.data.description, 100)
                      : "No description available."}
                  </Text>
                </>
              )}
            </Flex>
          </Card>
        </Box>
      )}

      <DeckGL
        views={new OrthographicView({ id: "ortho" })}
        controller={{
          dragPan: true,
          scrollZoom: true,
          touchZoom: true,
          inertia: false,
        }}
        pickingRadius={8}
        viewState={{
          ...viewState,
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
        }}
        onViewStateChange={({ viewState: nextViewState }) => {
          setViewState({
            target: nextViewState.target as [number, number, number],
            zoom: nextViewState.zoom as number,
          });
        }}
        layers={layers}
      />
      {isMapLoading && (
        <Flex
          align="center"
          justify="center"
          direction="column"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 24,
            pointerEvents: "none",
          }}
        >
          <Card
            variant="surface"
            size={{ initial: "2", md: "3" }}
            style={{
              width: "min(94vw, 500px)",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              background:
                resolvedTheme === "light"
                  ? "color-mix(in oklab, var(--gray-1) 76%, transparent)"
                  : "color-mix(in oklab, var(--gray-2) 78%, transparent)",
              border: "1px solid var(--gray-a6)",
              boxShadow: "var(--shadow-5)",
            }}
          >
            <Flex direction="column" gap="3">
              <Flex align="center" justify="between" gap="2">
                <Flex align="center" gap="2">
                  <Spinner size="2" />
                  <Heading as="h2" size={{ initial: "3", md: "4" }}>
                    Loading map
                  </Heading>
                </Flex>
                <Badge color="blue" variant="soft" size="2">
                  {progressPercent !== null ? `${progressPercent}%` : "Syncing"}
                </Badge>
              </Flex>

              <Text size="1" color="gray">
                {loadingSourceText}
              </Text>

              <Progress
                size="2"
                color="blue"
                radius="full"
                value={progressPercent ?? undefined}
                max={100}
              />

              <Separator size="4" />

              <Flex align="center" justify="between" gap="2">
                <Text size="1" color="gray">
                  Plotting points in background...
                </Text>
              </Flex>
            </Flex>
          </Card>
        </Flex>
      )}
    </Box>
  );
}
