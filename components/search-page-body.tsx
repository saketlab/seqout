"use client";
import { OrganismNameMode } from "@/components/organism_filter";
import ResultCard from "@/components/result-card";
import SearchBar from "@/components/search-bar";
import { SearchFilters, SearchOrganismRail } from "@/components/search-filters";
import { useSearchQuery } from "@/context/search_query";
import { SERVER_URL } from "@/utils/constants";
import { SearchResult } from "@/utils/types";
import {
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
} from "@radix-ui/react-icons";
import {
  Button,
  Flex,
  Select,
  Skeleton,
  Spinner,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useInfiniteQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SortBy = "relevance" | "date" | "citations" | "journal";

type RelevanceCursor = { rank: number; accession: string };
type SortedCursor = { sort_value: string | number; accession: string };
type Cursor = RelevanceCursor | SortedCursor | null;

type SearchResponse = {
  results: SearchResult[];
  total: number;
  took_ms: number;
  next_cursor: Cursor;
};

const SORT_CONFIG: Record<
  Exclude<SortBy, "relevance">,
  { param: string; order: string }
> = {
  date: { param: "year", order: "desc" },
  citations: { param: "citations", order: "desc" },
  journal: { param: "journal", order: "asc" },
};

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

function buildSearchUrl(
  query: string,
  db: string | null,
  sortBy: SortBy,
  cursor: Cursor,
): string {
  let url = `${SERVER_URL}/search?q=${encodeURIComponent(query)}`;
  if (db === "sra" || db === "geo" || db === "arrayexpress") {
    url += `&db=${encodeURIComponent(db)}`;
  }
  if (sortBy !== "relevance") {
    const config = SORT_CONFIG[sortBy];
    url += `&sortby=${config.param}&order=${config.order}`;
    if (cursor && "sort_value" in cursor) {
      url += `&cursor_sort=${encodeURIComponent(String(cursor.sort_value))}&cursor_acc=${encodeURIComponent(cursor.accession)}`;
    }
  } else if (cursor && "rank" in cursor) {
    url += `&cursor_rank=${cursor.rank}&cursor_acc=${encodeURIComponent(cursor.accession)}`;
  }
  return url;
}

const getSearchResults = async (
  query: string | null,
  db: string | null,
  cursor: Cursor,
  sortBy: SortBy,
): Promise<SearchResponse | null> => {
  if (!query) return null;
  const url = buildSearchUrl(query, db, sortBy, cursor);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Network Error");
  }
  return res.json();
};

const getGeoSearchResults = async (
  lat: string,
  lng: string,
  radiusKm: string | null,
  cursor: Cursor,
  organism: string | null,
  assayL2: string | null,
  source: string | null,
): Promise<SearchResponse | null> => {
  let url = `${SERVER_URL}/search/structured?geo_lat=${encodeURIComponent(lat)}&geo_lng=${encodeURIComponent(lng)}`;
  if (radiusKm) {
    url += `&geo_radius_km=${encodeURIComponent(radiusKm)}`;
  }
  if (organism) {
    url += `&organism=${encodeURIComponent(organism)}`;
  }
  if (assayL2) {
    url += `&assay_l2=${encodeURIComponent(assayL2)}`;
  }
  if (source) {
    url += `&source=${encodeURIComponent(source)}`;
  }
  if (cursor && "rank" in cursor) {
    url += `&cursor_rank=${cursor.rank}&cursor_acc=${encodeURIComponent(cursor.accession)}`;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Network Error");
  }
  return res.json();
};

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

function getPageRange(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "ellipsis")[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) pages.push("ellipsis");
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < total - 1) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

function Paginator({
  currentPage,
  totalPages,
  onPageChange,
  perPage,
  onPerPageChange,
  totalResults,
  loadedResults,
  isFetching,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  perPage: PageSize;
  onPerPageChange: (size: PageSize) => void;
  totalResults: number;
  loadedResults: number;
  isFetching: boolean;
}) {
  if (totalResults === 0) return null;
  const start = (currentPage - 1) * perPage + 1;
  const end = Math.min(currentPage * perPage, totalResults);
  const pages = getPageRange(currentPage, totalPages);

  return (
    <Flex direction="column" gap="3" align="center" py="2">
      {/* Info row */}
      <Flex gap="3" align="center" wrap="wrap" justify="center">
        <Text size="2" color="gray">
          {start}&ndash;{end} of {totalResults.toLocaleString()} results
        </Text>
        <Flex gap="1" align="center">
          <Select.Root
            value={String(perPage)}
            onValueChange={(v) => onPerPageChange(Number(v) as PageSize)}
            size="1"
          >
            <Select.Trigger variant="ghost" />
            <Select.Content>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <Select.Item key={size} value={String(size)}>
                  {size} per page
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
      </Flex>

      {/* Progress bar — visible while loading, disappears at 100% */}
      {isFetching && loadedResults < totalResults && (
        <div
          style={{
            width: "100%",
            maxWidth: 260,
            height: 3,
            background: "var(--gray-4)",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.min(100, (loadedResults / totalResults) * 100)}%`,
              height: "100%",
              background: "var(--accent-9)",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      )}

      {/* Page buttons */}
      {totalPages > 1 && (
        <Flex gap="1" align="center" wrap="wrap" justify="center">
          <Button
            variant="soft"
            size="1"
            disabled={currentPage === 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          {pages.map((p, i) =>
            p === "ellipsis" ? (
              <Text key={`e${i}`} size="2" color="gray" mx="1">
                &hellip;
              </Text>
            ) : (
              <Button
                key={p}
                variant={p === currentPage ? "solid" : "soft"}
                size="1"
                onClick={() => onPageChange(p)}
                style={{ minWidth: 32 }}
              >
                {p}
              </Button>
            ),
          )}
          <Button
            variant="soft"
            size="1"
            disabled={currentPage === totalPages}
            onClick={() => onPageChange(currentPage + 1)}
          >
            <ChevronRightIcon />
          </Button>
        </Flex>
      )}
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// Client-side filter helpers
// ---------------------------------------------------------------------------

function applyTimeFilter(
  results: SearchResult[],
  timeFilter: string,
  customYearRange: { from: string; to: string },
): SearchResult[] {
  if (timeFilter === "any") return results;
  if (timeFilter === "custom") {
    const from = parseInt(customYearRange.from);
    const to = parseInt(customYearRange.to);
    if (!from && !to) return results;
    return results.filter((r) => {
      const year = new Date(r.updated_at).getFullYear();
      if (from && year < from) return false;
      if (to && year > to) return false;
      return true;
    });
  }
  const years = parseInt(timeFilter);
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return results.filter((r) => new Date(r.updated_at) >= cutoff);
}

function applyOrganismFilter(
  results: SearchResult[],
  organismKey: string | null,
): SearchResult[] {
  if (!organismKey) return results;
  return results.filter((r) =>
    (r.organisms ?? []).some(
      (o) => o.trim().toLowerCase() === organismKey.toLowerCase(),
    ),
  );
}

function applyJournalFilter(
  results: SearchResult[],
  journal: string | null,
): SearchResult[] {
  if (!journal) return results;
  return results.filter((r) => r.journal?.trim() === journal);
}

function applyCountryFilter(
  results: SearchResult[],
  country: string | null,
): SearchResult[] {
  if (!country) return results;
  return results.filter((r) =>
    (r.countries ?? []).some(
      (c) => c.trim().toUpperCase() === country.toUpperCase(),
    ),
  );
}

function applyLibraryStrategyFilter(
  results: SearchResult[],
  strategy: string | null,
): SearchResult[] {
  if (!strategy) return results;
  return results.filter((r) =>
    (r.library_strategies ?? []).some((s) => s.trim() === strategy),
  );
}

function applyInstrumentModelFilter(
  results: SearchResult[],
  model: string | null,
): SearchResult[] {
  if (!model) return results;
  return results.filter((r) =>
    (r.instrument_models ?? []).some((m) => m.trim() === model),
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SearchPageBody() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.get("q");
  const db = searchParams.get("db");
  const geoLat = searchParams.get("geo_lat");
  const geoLng = searchParams.get("geo_lng");
  const geoRadiusKm = searchParams.get("geo_radius_km");
  const geoOrganism = searchParams.get("organism");
  const geoAssayL2 = searchParams.get("assay_l2");
  const geoSource = searchParams.get("source") ?? searchParams.get("db");
  const isGeoSearch = geoLat !== null && geoLng !== null;
  const { setLastSearchQuery } = useSearchQuery();

  useEffect(() => {
    if (query) setLastSearchQuery(query);
  }, [query, setLastSearchQuery]);

  // --- Sort & time ---
  const [sortBy, setSortBy] = useState<SortBy>("relevance");
  const [timeFilter, setTimeFilter] = useState<
    "any" | "1" | "5" | "10" | "20" | "custom"
  >("any");
  const [customYearRange, setCustomYearRange] = useState<{
    from: string;
    to: string;
  }>({ from: "", to: "" });

  // --- Organism ---
  const [organismNameMode, setOrganismNameMode] =
    useState<OrganismNameMode>("common");
  const [selectedOrganismKey, setSelectedOrganismKey] = useState<string | null>(
    null,
  );

  // --- Sidebar filters (single-select, client-side only) ---
  const [selectedJournal, setSelectedJournal] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedLibraryStrategy, setSelectedLibraryStrategy] = useState<
    string | null
  >(null);
  const [selectedInstrumentModel, setSelectedInstrumentModel] = useState<
    string | null
  >(null);

  // --- Pagination ---
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState<PageSize>(20);

  // Reset filters on new query/db
  useEffect(() => {
    setSelectedJournal(null);
    setSelectedCountry(null);
    setSelectedLibraryStrategy(null);
    setSelectedInstrumentModel(null);
    setSelectedOrganismKey(null);
    setCurrentPage(1);
  }, [query, db]);

  // Reset page on filter / sort / perPage change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    sortBy,
    timeFilter,
    customYearRange,
    selectedOrganismKey,
    selectedJournal,
    selectedCountry,
    selectedLibraryStrategy,
    selectedInstrumentModel,
    perPage,
  ]);

  // --- Data fetching (no filters in queryKey — filters are client-side) ---
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: isGeoSearch
      ? ["geo-search", geoLat, geoLng, geoRadiusKm, geoOrganism, geoAssayL2, geoSource]
      : ["search", query, db, sortBy],
    queryFn: ({ pageParam }) =>
      isGeoSearch
        ? getGeoSearchResults(geoLat!, geoLng!, geoRadiusKm, pageParam as Cursor, geoOrganism, geoAssayL2, geoSource)
        : getSearchResults(query, db, pageParam as Cursor, sortBy),
    initialPageParam: null as Cursor,
    getNextPageParam: (lastPage) => lastPage?.next_cursor ?? undefined,
    enabled: isGeoSearch || !!query,
  });

  const total = data?.pages?.[0]?.total ?? 0;
  const tookMs = data?.pages?.[0]?.took_ms ?? 0;

  // Flatten & deduplicate all loaded results
  const allResults = useMemo(() => {
    const flat = data?.pages.flatMap((page) => page?.results ?? []) ?? [];
    const seen = new Set<string>();
    return flat.filter((result) => {
      const id = `${result.source}:${result.accession}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [data]);

  // Background prefetch: eagerly load remaining pages
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) {
      prefetchTimerRef.current = setTimeout(() => fetchNextPage(), 150);
      return () => {
        if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
      };
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, data]);

  // --- Stable sidebar results ---
  // Use first batch for sidebar counts, then update once when all loading completes.
  // This prevents flickering as intermediate batches arrive.
  const sidebarResultsRef = useRef<SearchResult[]>([]);
  const allLoadedRef = useRef(false);

  const sidebarResults = useMemo(() => {
    const allLoaded =
      !hasNextPage && !isFetchingNextPage && allResults.length > 0;

    if (allLoaded && !allLoadedRef.current) {
      // All pages loaded — do one final update
      allLoadedRef.current = true;
      sidebarResultsRef.current = allResults;
      return allResults;
    }

    if (allLoadedRef.current) {
      // Already fully loaded, keep using the full set
      return sidebarResultsRef.current;
    }

    if (sidebarResultsRef.current.length === 0 && allResults.length > 0) {
      // First batch arrived — lock it in
      sidebarResultsRef.current = allResults;
      return allResults;
    }

    return sidebarResultsRef.current;
  }, [allResults, hasNextPage, isFetchingNextPage]);

  // Reset sidebar ref when query/db/sort changes (new search)
  useEffect(() => {
    sidebarResultsRef.current = [];
    allLoadedRef.current = false;
  }, [query, db, sortBy]);

  // --- Client-side filter chain ---
  // Applied to allResults for pagination display
  const filteredResults = useMemo(() => {
    let results = allResults;
    results = applyTimeFilter(results, timeFilter, customYearRange);
    results = applyOrganismFilter(results, selectedOrganismKey);
    results = applyJournalFilter(results, selectedJournal);
    results = applyCountryFilter(results, selectedCountry);
    results = applyLibraryStrategyFilter(results, selectedLibraryStrategy);
    results = applyInstrumentModelFilter(results, selectedInstrumentModel);
    return results;
  }, [
    allResults,
    timeFilter,
    customYearRange,
    selectedOrganismKey,
    selectedJournal,
    selectedCountry,
    selectedLibraryStrategy,
    selectedInstrumentModel,
  ]);

  // --- Pagination computation ---
  const filteredTotal = filteredResults.length;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / perPage));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * perPage;
  const pageResults = filteredResults.slice(startIdx, startIdx + perPage);

  // Handle page change — scroll to top of results
  const resultsTopRef = useRef<HTMLDivElement>(null);
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    resultsTopRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  // --- Adapter: wrap single-select state as string[] for SearchOrganismRail ---
  const journalFiltersArray = useMemo(
    () => (selectedJournal ? [selectedJournal] : []),
    [selectedJournal],
  );
  const countryFiltersArray = useMemo(
    () => (selectedCountry ? [selectedCountry] : []),
    [selectedCountry],
  );
  const libraryStrategyFiltersArray = useMemo(
    () => (selectedLibraryStrategy ? [selectedLibraryStrategy] : []),
    [selectedLibraryStrategy],
  );
  const instrumentModelFiltersArray = useMemo(
    () => (selectedInstrumentModel ? [selectedInstrumentModel] : []),
    [selectedInstrumentModel],
  );

  // Toggle adapters: convert string[] setter calls to single-select
  const handleSetJournalFilters = useCallback((arr: string[]) => {
    setSelectedJournal(arr.length > 0 ? arr[arr.length - 1] : null);
  }, []);
  const handleSetCountryFilters = useCallback((arr: string[]) => {
    setSelectedCountry(arr.length > 0 ? arr[arr.length - 1] : null);
  }, []);
  const handleSetLibraryStrategyFilters = useCallback((arr: string[]) => {
    setSelectedLibraryStrategy(arr.length > 0 ? arr[arr.length - 1] : null);
  }, []);
  const handleSetInstrumentModelFilters = useCallback((arr: string[]) => {
    setSelectedInstrumentModel(arr.length > 0 ? arr[arr.length - 1] : null);
  }, []);

  // --- UI state ---
  const [showTopButton, setShowTopButton] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  const shouldShowOrganismRail =
    !isLoading && !isError && allResults.length > 0;
  const shouldReserveRailSpace =
    isLoading || ((!!query || isGeoSearch) && (isError || allResults.length === 0));

  useEffect(() => {
    const onScroll = () => {
      setShowTopButton(window.scrollY > 200);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleDownloadResults = async () => {
    if (isDownloading || !query) return;

    setIsDownloading(true);
    setDownloadFailed(false);

    try {
      const params = new URLSearchParams();
      params.set("q", query);
      if (db === "sra" || db === "geo" || db === "arrayexpress") {
        params.set("db", db);
      }

      if (timeFilter === "custom") {
        const from = parseInt(customYearRange.from);
        const to = parseInt(customYearRange.to);
        if (from) params.set("updated_year_from", String(from));
        if (to) params.set("updated_year_to", String(to));
      } else if (timeFilter !== "any") {
        const years = parseInt(timeFilter);
        const currentYear = new Date().getFullYear();
        params.set("updated_year_from", String(currentYear - years));
        params.set("updated_year_to", String(currentYear));
      }

      const res = await fetch(
        `${SERVER_URL}/download/query?${params.toString()}`,
      );

      if (!res.ok) {
        throw new Error("Download failed");
      }

      const zipBlob = await res.blob();
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      const timestamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\..+/, "")
        .replace("T", "_");
      a.download = `results_${timestamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      setDownloadFailed(true);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDatabaseChange = (
    value: "geo" | "sra" | "arrayexpress" | "both",
  ) => {
    if (!query) return;

    let url = `/search?q=${encodeURIComponent(query)}`;
    if (value === "sra" || value === "geo" || value === "arrayexpress") {
      url += `&db=${encodeURIComponent(value)}`;
    }

    router.push(url);
  };

  // --- Sidebar rail props (use stable sidebarResults for counts) ---
  const railProps = {
    results: sidebarResults,
    journalResults: sidebarResults,
    countryResults: sidebarResults,
    libraryStrategyResults: sidebarResults,
    instrumentModelResults: sidebarResults,
    organismNameMode,
    setOrganismNameMode,
    selectedOrganismKey,
    setSelectedOrganismFilter: setSelectedOrganismKey,
    selectedJournalFilters: journalFiltersArray,
    setSelectedJournalFilters: handleSetJournalFilters,
    selectedCountryFilters: countryFiltersArray,
    setSelectedCountryFilters: handleSetCountryFilters,
    selectedLibraryStrategyFilters: libraryStrategyFiltersArray,
    setSelectedLibraryStrategyFilters: handleSetLibraryStrategyFilters,
    selectedInstrumentModelFilters: instrumentModelFiltersArray,
    setSelectedInstrumentModelFilters: handleSetInstrumentModelFilters,
  };

  // Whether any client-side filter is active (for "no results match" message)
  const hasAnyFilter =
    selectedOrganismKey != null ||
    selectedJournal != null ||
    selectedCountry != null ||
    selectedLibraryStrategy != null ||
    selectedInstrumentModel != null ||
    timeFilter !== "any";

  return (
    <>
      <SearchBar initialQuery={query} />

      <Flex
        gap={"4"}
        px={{ initial: "0", md: "4" }}
        width={{ initial: "98%", md: "100%" }}
        mx="auto"
        justify={{ initial: "start", md: "between" }}
        direction={{ initial: "column", md: "row" }}
      >
        <SearchFilters
          db={db}
          query={query}
          setSortBy={setSortBy}
          setTimeFilter={setTimeFilter}
          timeFilter={timeFilter}
          customYearRange={customYearRange}
          setCustomYearRange={setCustomYearRange}
          onDatabaseChange={handleDatabaseChange}
        />
        {shouldShowOrganismRail ? (
          <SearchOrganismRail {...railProps} showMobile showDesktop={false} />
        ) : null}

        {/* Results column */}
        <Flex
          gap="4"
          direction="column"
          width={{ initial: "100%", md: "58%", lg: "65%", xl: "73%" }}
        >
          <div ref={resultsTopRef} />
          {!query && !isGeoSearch ? (
            <Text>Start by typing a search query above.</Text>
          ) : isLoading ? (
            <>
              <Flex gap="2" align="center">
                <Spinner size="1" />
                <Text color="gray" weight="light">
                  Fetching results...
                </Text>
              </Flex>
              <Skeleton width={"100%"} height={"6rem"} />
              <Skeleton width={"100%"} height={"6rem"} />
              <Skeleton width={"100%"} height={"6rem"} />
              <Skeleton width={"100%"} height={"6rem"} />
              <Skeleton width={"100%"} height={"6rem"} />
            </>
          ) : isError ? (
            <Flex
              gap="2"
              align="center"
              justify="center"
              height={"20rem"}
              direction={"column"}
            >
              <Image
                src="./controls.svg"
                alt="empty box"
                width={"100"}
                height={"100"}
              />
              <Text color="gray" size={"6"} weight={"bold"}>
                Failed to connect
              </Text>
              <Text color="gray" size={"2"}>
                Check your network connection
              </Text>
            </Flex>
          ) : allResults.length > 0 ? (
            <>
              <Flex justify="between" align="center" wrap="wrap" gap="2">
                <Text color="gray" weight={"light"}>
                  {total.toLocaleString()} result{total === 1 ? "" : "s"} in{" "}
                  {(tookMs / 1000).toFixed(2)}s
                  {hasAnyFilter && filteredTotal < allResults.length && (
                    <> ({filteredTotal.toLocaleString()} after filters)</>
                  )}
                </Text>
              </Flex>

              {pageResults.length === 0 ? (
                <Flex
                  align="center"
                  justify="center"
                  direction={"column"}
                  height={"12rem"}
                >
                  {isFetchingNextPage ? (
                    <>
                      <Spinner size="3" />
                      <Text color="gray" size="2" mt="2">
                        Loading this page&hellip;
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text color="gray" size={"4"} weight={"bold"}>
                        No results match your filters
                      </Text>
                      <Text color="gray" size={"2"}>
                        Try clearing active filters or widening the time range.
                      </Text>
                    </>
                  )}
                </Flex>
              ) : (
                pageResults.map((searchResult) => (
                  <ResultCard
                    key={`${searchResult.source}:${searchResult.accession}`}
                    accesssion={searchResult.accession}
                    title={searchResult.title}
                    summary={searchResult.summary}
                    updated_at={searchResult.updated_at}
                    journal={searchResult.journal}
                    doi={searchResult.doi}
                    citation_count={searchResult.citation_count}
                  />
                ))
              )}

              {/* Paginator */}
              <Paginator
                currentPage={safePage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
                perPage={perPage}
                onPerPageChange={setPerPage}
                totalResults={filteredTotal}
                loadedResults={allResults.length}
                isFetching={isFetchingNextPage}
              />
            </>
          ) : (
            <Flex
              align="center"
              justify="center"
              direction={"column"}
              height={"20rem"}
            >
              <Image
                draggable={"false"}
                src="./empty-box.svg"
                alt="empty box"
                width={"100"}
                height={"100"}
              />
              <Text color="gray" size={"6"} weight={"bold"}>
                No results found
              </Text>
              <Text color="gray" size={"2"}>
                Try refining your search text
              </Text>
            </Flex>
          )}
        </Flex>

        {shouldReserveRailSpace ? (
          <Flex
            display={{ initial: "none", md: "flex" }}
            direction="column"
            width={{ md: "220px", lg: "280px" }}
          />
        ) : shouldShowOrganismRail ? (
          <SearchOrganismRail {...railProps} showMobile={false} showDesktop />
        ) : null}

        {filteredResults.length > 0 && (
          <Flex
            position="fixed"
            direction="column"
            align={"end"}
            gap="2"
            style={{ right: "1rem", bottom: "1rem", zIndex: 999 }}
          >
            {showTopButton && (
              <Tooltip content="Go back to top">
                <Button
                  style={{ width: "fit-content", padding: 16 }}
                  onClick={() =>
                    window.scrollTo({ top: 0, behavior: "smooth" })
                  }
                >
                  <ArrowUpIcon />
                </Button>
              </Tooltip>
            )}
            <Tooltip
              content={
                downloadFailed
                  ? "Download failed. Please try again."
                  : "Download search results as ZIP"
              }
            >
              <Button onClick={handleDownloadResults} disabled={isDownloading}>
                {isDownloading ? <Spinner /> : <DownloadIcon />}
                {isDownloading ? "Preparing ZIP..." : "Download"}
              </Button>
            </Tooltip>
          </Flex>
        )}
      </Flex>
    </>
  );
}
