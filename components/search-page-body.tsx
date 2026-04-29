"use client";
import { OrganismNameMode } from "@/components/organism_filter";
import ResultCard from "@/components/result-card";
import SearchBar from "@/components/search-bar";
import { SearchFilters, SearchOrganismRail } from "@/components/search-filters";
import { useSearchQuery } from "@/context/search_query";
import { SERVER_URL } from "@/utils/constants";
import { getProjectShortUrl } from "@/utils/shortUrl";
import { SearchResult } from "@/utils/types";
import {
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Cross1Icon,
  DownloadIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import {
  Badge,
  Button,
  Flex,
  Select,
  Skeleton,
  Spinner,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useInfiniteQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SortBy = "relevance" | "date" | "citations" | "journal";

type RelevanceCursor = { rank: number; accession: string };
type SortedCursor = { sort_value: string | number; accession: string };
type Cursor = RelevanceCursor | SortedCursor | null;

type SpellingCorrection = {
  original: string;
  suggested: string;
  distance: number | null;
};

type SpellingSuggestion = {
  corrected_query: string;
  corrections: SpellingCorrection[];
};

type SearchResponse = {
  results: SearchResult[];
  total: number;
  took_ms: number;
  next_cursor: Cursor;
  suggestions?: SpellingSuggestion[];
};

type TimeFilter = "any" | "1" | "5" | "10" | "20" | "custom";

function DidYouMean({
  suggestion,
  searchParams,
  onNavigate,
}: {
  suggestion: SpellingSuggestion;
  searchParams: ReturnType<typeof import("next/navigation").useSearchParams>;
  onNavigate: (url: string) => void;
}) {
  const corrected = suggestion.corrected_query;
  const href = (() => {
    const p = new URLSearchParams(searchParams.toString());
    p.set("q", corrected);
    p.delete("cursor_rank");
    p.delete("cursor_acc");
    return `/search?${p.toString()}`;
  })();

  return (
    <Text color="gray" size={"2"}>
      Did you mean:{" "}
      <Text
        asChild
        size={"2"}
        weight={"bold"}
        style={{
          color: "var(--accent-11)",
          cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            onNavigate(href);
          }}
        >
          {corrected}
        </a>
      </Text>
      ?
    </Text>
  );
}

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

const FILTER_PARAM_KEYS = {
  sortBy: "sort",
  time: "time",
  yearFrom: "year_from",
  yearTo: "year_to",
  organism: "filter_organism",
  journal: "filter_journal",
  country: "filter_country",
  libraryStrategy: "filter_library_strategy",
  instrumentModel: "filter_instrument_model",
  platform: "filter_platform",
  multiPlatform: "multi_platform",
} as const;

function parseSortBy(value: string | null): SortBy {
  return value === "relevance" ||
    value === "date" ||
    value === "citations" ||
    value === "journal"
    ? value
    : "relevance";
}

function parseTimeFilter(
  value: string | null,
  yearFrom: string | null,
  yearTo: string | null,
): TimeFilter {
  if (value === "custom" || yearFrom || yearTo) return "custom";
  return value === "1" || value === "5" || value === "10" || value === "20"
    ? value
    : "any";
}

function normalizeMultiValueFilter(values: string[]): string[] {
  return values.map((item) => item.trim()).filter(Boolean);
}

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

      {totalPages > 1 && (
        <nav aria-label="Pagination">
          <Flex gap="1" align="center" wrap="wrap" justify="center">
            <Button
              variant="soft"
              size={{ initial: "2", md: "1" }}
              disabled={currentPage === 1}
              onClick={() => onPageChange(currentPage - 1)}
              aria-label="Previous page"
              className="seqout-paginator-btn"
            >
              <ChevronLeftIcon />
            </Button>
            {pages.map((p, i) =>
              p === "ellipsis" ? (
                <Text key={`e${i}`} size="2" color="gray" mx="1" aria-hidden>
                  &hellip;
                </Text>
              ) : (
                <Button
                  key={p}
                  variant={p === currentPage ? "solid" : "soft"}
                  size={{ initial: "2", md: "1" }}
                  onClick={() => onPageChange(p)}
                  aria-label={`Go to page ${p}`}
                  aria-current={p === currentPage ? "page" : undefined}
                  className="seqout-paginator-btn"
                >
                  {p}
                </Button>
              ),
            )}
            <Button
              variant="soft"
              size={{ initial: "2", md: "1" }}
              disabled={currentPage === totalPages}
              onClick={() => onPageChange(currentPage + 1)}
              aria-label="Next page"
              className="seqout-paginator-btn"
            >
              <ChevronRightIcon />
            </Button>
          </Flex>
        </nav>
      )}
    </Flex>
  );
}




const SORT_LABELS: Record<SortBy, string> = {
  relevance: "Relevance",
  date: "Newest first",
  citations: "Most cited",
  journal: "By journal",
};

const TIME_LABELS: Record<string, string> = {
  any: "Any time",
  "1": "Last year",
  "5": "Last 5 years",
  "10": "Last 10 years",
  "20": "Last 20 years",
};

const DB_LABELS_DISPLAY: Record<string, string> = {
  geo: "GEO",
  sra: "SRA",
  arrayexpress: "ArrayExpress",
};

type ActiveFilterChipsProps = {
  sortBy: SortBy;
  onResetSort: () => void;
  timeFilter: string;
  customYearRange: { from: string; to: string };
  onResetTime: () => void;
  db: string | null;
  onResetDb: () => void;
  selectedOrganismKey: string | null;
  onResetOrganism: () => void;
  selectedJournalFilters: string[];
  setSelectedJournalFilters: (next: string[]) => void;
  selectedCountryFilters: string[];
  setSelectedCountryFilters: (next: string[]) => void;
  selectedLibraryStrategyFilters: string[];
  setSelectedLibraryStrategyFilters: (next: string[]) => void;
  selectedInstrumentModelFilters: string[];
  setSelectedInstrumentModelFilters: (next: string[]) => void;
  selectedPlatformFilters: string[];
  setSelectedPlatformFilters: (next: string[]) => void;
  multiPlatformOnly: boolean;
  setMultiPlatformOnly: (next: boolean) => void;
  onClearAll: () => void;
};

function FilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <Badge size="2" color="gray" variant="soft">
      <Flex align="center" gap="1">
        <Text size="1">{label}</Text>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label} filter`}
          style={{
            border: "none",
            background: "transparent",
            color: "inherit",
            // 6px padding + 11px icon + 6px padding = 23px ≈ 24×24 hit area,
            // negative margin keeps the visual chip compact.
            padding: "6px",
            margin: "-6px -4px -6px 0",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "24px",
            minHeight: "24px",
            cursor: "pointer",
            opacity: 0.7,
            borderRadius: "var(--radius-2)",
            transition: "opacity 120ms, background 120ms",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "1";
            e.currentTarget.style.background = "var(--gray-a3)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "0.7";
            e.currentTarget.style.background = "transparent";
          }}
        >
          <Cross1Icon width="11" height="11" />
        </button>
      </Flex>
    </Badge>
  );
}

function ActiveFilterChips(props: ActiveFilterChipsProps) {
  const chips: React.ReactNode[] = [];

  if (props.sortBy !== "relevance") {
    chips.push(
      <FilterChip
        key="sort"
        label={`Sort: ${SORT_LABELS[props.sortBy]}`}
        onRemove={props.onResetSort}
      />,
    );
  }

  if (props.timeFilter !== "any") {
    let timeLabel: string;
    if (props.timeFilter === "custom") {
      const { from, to } = props.customYearRange;
      timeLabel = from && to ? `${from}–${to}` : from ? `From ${from}` : `To ${to}`;
      timeLabel = `Time: ${timeLabel}`;
    } else {
      timeLabel = `Time: ${TIME_LABELS[props.timeFilter] ?? props.timeFilter}`;
    }
    chips.push(
      <FilterChip key="time" label={timeLabel} onRemove={props.onResetTime} />,
    );
  }

  if (props.db) {
    chips.push(
      <FilterChip
        key="db"
        label={`Source: ${DB_LABELS_DISPLAY[props.db] ?? props.db}`}
        onRemove={props.onResetDb}
      />,
    );
  }

  if (props.selectedOrganismKey) {
    chips.push(
      <FilterChip
        key="organism"
        label={`Organism: ${props.selectedOrganismKey}`}
        onRemove={props.onResetOrganism}
      />,
    );
  }

  if (props.multiPlatformOnly) {
    chips.push(
      <FilterChip
        key="multi-platform"
        label="Multi-platform only"
        onRemove={() => props.setMultiPlatformOnly(false)}
      />,
    );
  }

  for (const journal of props.selectedJournalFilters) {
    chips.push(
      <FilterChip
        key={`j-${journal}`}
        label={`Journal: ${journal}`}
        onRemove={() =>
          props.setSelectedJournalFilters(
            props.selectedJournalFilters.filter((v) => v !== journal),
          )
        }
      />,
    );
  }

  for (const country of props.selectedCountryFilters) {
    chips.push(
      <FilterChip
        key={`c-${country}`}
        label={`Country: ${country}`}
        onRemove={() =>
          props.setSelectedCountryFilters(
            props.selectedCountryFilters.filter((v) => v !== country),
          )
        }
      />,
    );
  }

  for (const strategy of props.selectedLibraryStrategyFilters) {
    chips.push(
      <FilterChip
        key={`l-${strategy}`}
        label={`Library: ${strategy}`}
        onRemove={() =>
          props.setSelectedLibraryStrategyFilters(
            props.selectedLibraryStrategyFilters.filter((v) => v !== strategy),
          )
        }
      />,
    );
  }

  for (const model of props.selectedInstrumentModelFilters) {
    chips.push(
      <FilterChip
        key={`i-${model}`}
        label={`Instrument: ${model}`}
        onRemove={() =>
          props.setSelectedInstrumentModelFilters(
            props.selectedInstrumentModelFilters.filter((v) => v !== model),
          )
        }
      />,
    );
  }

  for (const platform of props.selectedPlatformFilters) {
    chips.push(
      <FilterChip
        key={`p-${platform}`}
        label={`Platform: ${platform}`}
        onRemove={() =>
          props.setSelectedPlatformFilters(
            props.selectedPlatformFilters.filter((v) => v !== platform),
          )
        }
      />,
    );
  }

  if (chips.length === 0) return null;

  return (
    <Flex gap="2" align="center" wrap="wrap" pt="1">
      {chips}
      <Button
        variant="ghost"
        size="1"
        color="gray"
        onClick={props.onClearAll}
        aria-label="Clear all filters"
      >
        Clear all
      </Button>
    </Flex>
  );
}




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

function applyJournalFilter(results: SearchResult[], journals: string[]): SearchResult[] {
  if (journals.length === 0) return results;
  const selectedJournals = new Set(journals);
  return results.filter((r) => {
    const journal = r.journal?.trim();
    return journal ? selectedJournals.has(journal) : false;
  });
}

function applyCountryFilter(
  results: SearchResult[],
  countries: string[],
): SearchResult[] {
  if (countries.length === 0) return results;
  const selectedCountries = new Set(
    countries.map((country) => country.toUpperCase()),
  );
  return results.filter((r) =>
    (r.countries ?? []).some(
      (c) => selectedCountries.has(c.trim().toUpperCase()),
    ),
  );
}

function applyLibraryStrategyFilter(
  results: SearchResult[],
  strategies: string[],
): SearchResult[] {
  if (strategies.length === 0) return results;
  const selectedStrategies = new Set(strategies);
  return results.filter((r) =>
    (r.library_strategies ?? []).some((s) => selectedStrategies.has(s.trim())),
  );
}

function applyInstrumentModelFilter(
  results: SearchResult[],
  models: string[],
): SearchResult[] {
  if (models.length === 0) return results;
  const selectedModels = new Set(models);
  return results.filter((r) =>
    (r.instrument_models ?? []).some((m) => selectedModels.has(m.trim())),
  );
}

function applyPlatformFilter(
  results: SearchResult[],
  platforms: string[],
): SearchResult[] {
  if (platforms.length === 0) return results;
  const selected = new Set(platforms);
  return results.filter((r) =>
    (r.platforms ?? []).some((p) => selected.has(p.trim())),
  );
}

function applyMultiPlatformFilter(
  results: SearchResult[],
  multiPlatformOnly: boolean,
): SearchResult[] {
  if (!multiPlatformOnly) return results;
  return results.filter((r) => (r.platforms ?? []).length >= 2);
}

function getAvailableJournals(results: SearchResult[]): Set<string> {
  const journals = new Set<string>();
  for (const result of results) {
    const journal = result.journal?.trim();
    if (journal) journals.add(journal);
  }
  return journals;
}

function getAvailableCountries(results: SearchResult[]): Set<string> {
  const countries = new Set<string>();
  for (const result of results) {
    for (const country of result.countries ?? []) {
      const normalizedCountry = country.trim().toUpperCase();
      if (normalizedCountry) countries.add(normalizedCountry);
    }
  }
  return countries;
}

function getAvailableLibraryStrategies(results: SearchResult[]): Set<string> {
  const strategies = new Set<string>();
  for (const result of results) {
    for (const strategy of result.library_strategies ?? []) {
      const normalizedStrategy = strategy.trim();
      if (normalizedStrategy) strategies.add(normalizedStrategy);
    }
  }
  return strategies;
}

function getAvailableInstrumentModels(results: SearchResult[]): Set<string> {
  const models = new Set<string>();
  for (const result of results) {
    for (const model of result.instrument_models ?? []) {
      const normalizedModel = model.trim();
      if (normalizedModel) models.add(normalizedModel);
    }
  }
  return models;
}




export default function SearchPageBody() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
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

  const updateSearchUrl = useCallback(
    (
      updates: Record<
        string,
        string | string[] | null | undefined
      >,
    ) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        if (Array.isArray(value)) {
          params.delete(key);
          for (const item of normalizeMultiValueFilter(value)) {
            params.append(key, item);
          }
          continue;
        }

        if (value == null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }

      const nextQuery = params.toString();
      const currentQuery = searchParams.toString();
      if (nextQuery === currentQuery) return;

      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const sortBy = parseSortBy(searchParams.get(FILTER_PARAM_KEYS.sortBy));
  const timeFilter = parseTimeFilter(
    searchParams.get(FILTER_PARAM_KEYS.time),
    searchParams.get(FILTER_PARAM_KEYS.yearFrom),
    searchParams.get(FILTER_PARAM_KEYS.yearTo),
  );
  const customYearRange = useMemo(
    () => ({
      from: searchParams.get(FILTER_PARAM_KEYS.yearFrom) ?? "",
      to: searchParams.get(FILTER_PARAM_KEYS.yearTo) ?? "",
    }),
    [searchParams],
  );

  const [organismNameMode, setOrganismNameMode] =
    useState<OrganismNameMode>("common");
  const selectedOrganismKey = searchParams.get(FILTER_PARAM_KEYS.organism);

  // Filters below are client-side only — not in the queryKey.
  const selectedJournalFilters = useMemo(
    () => normalizeMultiValueFilter(searchParams.getAll(FILTER_PARAM_KEYS.journal)),
    [searchParams],
  );
  const selectedCountryFilters = useMemo(
    () => normalizeMultiValueFilter(searchParams.getAll(FILTER_PARAM_KEYS.country)),
    [searchParams],
  );
  const selectedLibraryStrategyFilters = useMemo(
    () =>
      normalizeMultiValueFilter(
        searchParams.getAll(FILTER_PARAM_KEYS.libraryStrategy),
      ),
    [searchParams],
  );
  const selectedInstrumentModelFilters = useMemo(
    () =>
      normalizeMultiValueFilter(
        searchParams.getAll(FILTER_PARAM_KEYS.instrumentModel),
      ),
    [searchParams],
  );
  const selectedPlatformFilters = useMemo(
    () =>
      normalizeMultiValueFilter(
        searchParams.getAll(FILTER_PARAM_KEYS.platform),
      ),
    [searchParams],
  );
  const multiPlatformOnly =
    searchParams.get(FILTER_PARAM_KEYS.multiPlatform) === "true";

  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState<PageSize>(20);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    query,
    db,
    sortBy,
    timeFilter,
    customYearRange,
    selectedOrganismKey,
    selectedJournalFilters,
    selectedCountryFilters,
    selectedLibraryStrategyFilters,
    selectedInstrumentModelFilters,
    perPage,
  ]);

  const {
    data,
    isLoading,
    isError,
    refetch,
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
  const suggestions = data?.pages?.[0]?.suggestions;

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

  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) {
      prefetchTimerRef.current = setTimeout(() => fetchNextPage(), 150);
      return () => {
        if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
      };
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Snapshot sidebar results on first batch and on final load to prevent
  // facet counts from flickering as intermediate pages stream in.
  const sidebarResultsRef = useRef<SearchResult[]>([]);
  const allLoadedRef = useRef(false);

  const sidebarResults = useMemo(() => {
    const allLoaded =
      !hasNextPage && !isFetchingNextPage && allResults.length > 0;

    if (allLoaded && !allLoadedRef.current) {
      allLoadedRef.current = true;
      sidebarResultsRef.current = allResults;
      return allResults;
    }

    if (allLoadedRef.current) {
      return sidebarResultsRef.current;
    }

    if (sidebarResultsRef.current.length === 0 && allResults.length > 0) {
      sidebarResultsRef.current = allResults;
      return allResults;
    }

    return sidebarResultsRef.current;
  }, [allResults, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    sidebarResultsRef.current = [];
    allLoadedRef.current = false;
  }, [query, db, sortBy]);

  const filteredResults = useMemo(() => {
    let results = allResults;
    results = applyTimeFilter(results, timeFilter, customYearRange);
    results = applyOrganismFilter(results, selectedOrganismKey);
    results = applyJournalFilter(results, selectedJournalFilters);
    results = applyCountryFilter(results, selectedCountryFilters);
    results = applyLibraryStrategyFilter(results, selectedLibraryStrategyFilters);
    results = applyInstrumentModelFilter(results, selectedInstrumentModelFilters);
    results = applyPlatformFilter(results, selectedPlatformFilters);
    results = applyMultiPlatformFilter(results, multiPlatformOnly);
    return results;
  }, [
    allResults,
    timeFilter,
    customYearRange,
    selectedOrganismKey,
    selectedJournalFilters,
    selectedCountryFilters,
    selectedLibraryStrategyFilters,
    selectedInstrumentModelFilters,
    selectedPlatformFilters,
    multiPlatformOnly,
  ]);

  const moreFilterBaseResults = useMemo(() => {
    let results = sidebarResults;
    results = applyTimeFilter(results, timeFilter, customYearRange);
    results = applyOrganismFilter(results, selectedOrganismKey);
    return results;
  }, [sidebarResults, timeFilter, customYearRange, selectedOrganismKey]);

  const journalFilterResults = useMemo(() => {
    let results = moreFilterBaseResults;
    results = applyCountryFilter(results, selectedCountryFilters);
    results = applyLibraryStrategyFilter(results, selectedLibraryStrategyFilters);
    results = applyInstrumentModelFilter(results, selectedInstrumentModelFilters);
    return results;
  }, [
    moreFilterBaseResults,
    selectedCountryFilters,
    selectedLibraryStrategyFilters,
    selectedInstrumentModelFilters,
  ]);

  const countryFilterResults = useMemo(() => {
    let results = moreFilterBaseResults;
    results = applyJournalFilter(results, selectedJournalFilters);
    results = applyLibraryStrategyFilter(results, selectedLibraryStrategyFilters);
    results = applyInstrumentModelFilter(results, selectedInstrumentModelFilters);
    return results;
  }, [
    moreFilterBaseResults,
    selectedJournalFilters,
    selectedLibraryStrategyFilters,
    selectedInstrumentModelFilters,
  ]);

  const libraryStrategyFilterResults = useMemo(() => {
    let results = moreFilterBaseResults;
    results = applyJournalFilter(results, selectedJournalFilters);
    results = applyCountryFilter(results, selectedCountryFilters);
    results = applyInstrumentModelFilter(results, selectedInstrumentModelFilters);
    return results;
  }, [
    moreFilterBaseResults,
    selectedJournalFilters,
    selectedCountryFilters,
    selectedInstrumentModelFilters,
  ]);

  const instrumentModelFilterResults = useMemo(() => {
    let results = moreFilterBaseResults;
    results = applyJournalFilter(results, selectedJournalFilters);
    results = applyCountryFilter(results, selectedCountryFilters);
    results = applyLibraryStrategyFilter(results, selectedLibraryStrategyFilters);
    results = applyPlatformFilter(results, selectedPlatformFilters);
    results = applyMultiPlatformFilter(results, multiPlatformOnly);
    return results;
  }, [
    moreFilterBaseResults,
    selectedJournalFilters,
    selectedCountryFilters,
    selectedLibraryStrategyFilters,
    selectedPlatformFilters,
    multiPlatformOnly,
  ]);

  const platformFilterResults = useMemo(() => {
    let results = moreFilterBaseResults;
    results = applyJournalFilter(results, selectedJournalFilters);
    results = applyCountryFilter(results, selectedCountryFilters);
    results = applyLibraryStrategyFilter(results, selectedLibraryStrategyFilters);
    results = applyInstrumentModelFilter(results, selectedInstrumentModelFilters);
    return results;
  }, [
    moreFilterBaseResults,
    selectedJournalFilters,
    selectedCountryFilters,
    selectedLibraryStrategyFilters,
    selectedInstrumentModelFilters,
  ]);

  useEffect(() => {
    const nextJournalFilters = selectedJournalFilters.filter((journal) =>
      getAvailableJournals(journalFilterResults).has(journal),
    );
    const nextCountryFilters = selectedCountryFilters.filter((country) =>
      getAvailableCountries(countryFilterResults).has(country.toUpperCase()),
    );
    const nextLibraryStrategyFilters = selectedLibraryStrategyFilters.filter(
      (strategy) =>
        getAvailableLibraryStrategies(libraryStrategyFilterResults).has(
          strategy,
        ),
    );
    const nextInstrumentModelFilters = selectedInstrumentModelFilters.filter(
      (model) =>
        getAvailableInstrumentModels(instrumentModelFilterResults).has(model),
    );

    const journalsChanged =
      nextJournalFilters.length !== selectedJournalFilters.length;
    const countriesChanged =
      nextCountryFilters.length !== selectedCountryFilters.length;
    const libraryStrategiesChanged =
      nextLibraryStrategyFilters.length !==
      selectedLibraryStrategyFilters.length;
    const instrumentModelsChanged =
      nextInstrumentModelFilters.length !==
      selectedInstrumentModelFilters.length;

    if (
      !journalsChanged &&
      !countriesChanged &&
      !libraryStrategiesChanged &&
      !instrumentModelsChanged
    ) {
      return;
    }

    updateSearchUrl({
      [FILTER_PARAM_KEYS.journal]: nextJournalFilters,
      [FILTER_PARAM_KEYS.country]: nextCountryFilters,
      [FILTER_PARAM_KEYS.libraryStrategy]: nextLibraryStrategyFilters,
      [FILTER_PARAM_KEYS.instrumentModel]: nextInstrumentModelFilters,
    });
  }, [
    selectedJournalFilters,
    selectedCountryFilters,
    selectedLibraryStrategyFilters,
    selectedInstrumentModelFilters,
    journalFilterResults,
    countryFilterResults,
    libraryStrategyFilterResults,
    instrumentModelFilterResults,
    updateSearchUrl,
  ]);

  const filteredTotal = filteredResults.length;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / perPage));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * perPage;
  const pageResults = filteredResults.slice(startIdx, startIdx + perPage);

  const liveStatusMessage = useMemo(() => {
    if (!query && !isGeoSearch) return "";
    if (isLoading) return "Loading search results.";
    if (isError) return "Search failed. The server could not be reached.";
    if (allResults.length === 0) return `No results found for ${query}.`;
    if (filteredTotal === 0) {
      return `${allResults.length.toLocaleString()} result${allResults.length === 1 ? "" : "s"} were filtered out. Try removing a filter.`;
    }
    const pageCount = pageResults.length;
    if (hasNextPage) {
      return `${filteredTotal.toLocaleString()}+ results. Showing page ${safePage} of ${totalPages}, ${pageCount} result${pageCount === 1 ? "" : "s"}.`;
    }
    return `${filteredTotal.toLocaleString()} result${filteredTotal === 1 ? "" : "s"}. Showing page ${safePage} of ${totalPages}.`;
  }, [
    query,
    isGeoSearch,
    isLoading,
    isError,
    allResults.length,
    filteredTotal,
    pageResults.length,
    hasNextPage,
    safePage,
    totalPages,
  ]);
  // Debounce SR announcements so rapid filter churn doesn't spam the user.
  const [announcedStatus, setAnnouncedStatus] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setAnnouncedStatus(liveStatusMessage), 500);
    return () => clearTimeout(id);
  }, [liveStatusMessage]);

  const resultsTopRef = useRef<HTMLDivElement>(null);
  const resultsListRef = useRef<HTMLDivElement>(null);
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    resultsTopRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp" &&
        event.key !== "ArrowRight" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable ||
          target.closest('[role="dialog"]')
        ) {
          return;
        }
      }
      const container = resultsListRef.current;
      if (!container) return;
      const links = Array.from(
        container.querySelectorAll<HTMLAnchorElement>(
          '[data-result-link="true"]',
        ),
      );
      if (links.length === 0) return;
      const activeEl = document.activeElement as HTMLElement | null;
      const currentIndex = activeEl
        ? links.indexOf(activeEl as HTMLAnchorElement)
        : -1;

      if (event.key === "ArrowRight") {
        if (currentIndex < 0) return;
        event.preventDefault();
        links[currentIndex]?.click();
        return;
      }

      let nextIndex: number;
      if (event.key === "ArrowDown") {
        nextIndex =
          currentIndex < 0 ? 0 : Math.min(currentIndex + 1, links.length - 1);
      } else if (event.key === "ArrowUp") {
        nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else {
        nextIndex = links.length - 1;
      }
      event.preventDefault();
      const next = links[nextIndex];
      if (!next) return;
      next.focus({ preventScroll: true });
      const card = next.closest(".seqout-result-card") ?? next;
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const handleSetJournalFilters = useCallback((arr: string[]) => {
    updateSearchUrl({
      [FILTER_PARAM_KEYS.journal]: arr,
    });
  }, [updateSearchUrl]);
  const handleSetCountryFilters = useCallback((arr: string[]) => {
    updateSearchUrl({
      [FILTER_PARAM_KEYS.country]: arr,
    });
  }, [updateSearchUrl]);
  const handleSetLibraryStrategyFilters = useCallback((arr: string[]) => {
    updateSearchUrl({
      [FILTER_PARAM_KEYS.libraryStrategy]: arr,
    });
  }, [updateSearchUrl]);
  const handleSetInstrumentModelFilters = useCallback((arr: string[]) => {
    updateSearchUrl({
      [FILTER_PARAM_KEYS.instrumentModel]: arr,
    });
  }, [updateSearchUrl]);
  const handleSetPlatformFilters = useCallback((arr: string[]) => {
    updateSearchUrl({
      [FILTER_PARAM_KEYS.platform]: arr,
    });
  }, [updateSearchUrl]);
  const handleSetMultiPlatform = useCallback((val: boolean) => {
    updateSearchUrl({
      [FILTER_PARAM_KEYS.multiPlatform]: val ? "true" : null,
    });
  }, [updateSearchUrl]);
  const handleClearMoreFilters = useCallback(() => {
    updateSearchUrl({
      [FILTER_PARAM_KEYS.journal]: [],
      [FILTER_PARAM_KEYS.country]: [],
      [FILTER_PARAM_KEYS.libraryStrategy]: [],
      [FILTER_PARAM_KEYS.instrumentModel]: [],
      [FILTER_PARAM_KEYS.platform]: [],
      [FILTER_PARAM_KEYS.multiPlatform]: null,
    });
  }, [updateSearchUrl]);

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

  const handleDatabaseChange = useCallback(
    (value: "geo" | "sra" | "arrayexpress" | "both") => {
      if (!query) return;

      const params = new URLSearchParams(searchParams.toString());
      params.set("q", query);
      if (value === "sra" || value === "geo" || value === "arrayexpress") {
        params.set("db", value);
      } else {
        params.delete("db");
      }

      const nextQuery = params.toString();
      router.push(nextQuery ? `${pathname}?${nextQuery}` : pathname);
    },
    [query, searchParams, router, pathname],
  );

  const railProps = {
    results: sidebarResults,
    journalResults: journalFilterResults,
    countryResults: countryFilterResults,
    libraryStrategyResults: libraryStrategyFilterResults,
    instrumentModelResults: instrumentModelFilterResults,
    organismNameMode,
    setOrganismNameMode,
    selectedOrganismKey,
    setSelectedOrganismFilter: (value: string | null) =>
      updateSearchUrl({
        [FILTER_PARAM_KEYS.organism]: value,
      }),
    selectedJournalFilters,
    setSelectedJournalFilters: handleSetJournalFilters,
    selectedCountryFilters,
    setSelectedCountryFilters: handleSetCountryFilters,
    selectedLibraryStrategyFilters,
    setSelectedLibraryStrategyFilters: handleSetLibraryStrategyFilters,
    selectedInstrumentModelFilters,
    setSelectedInstrumentModelFilters: handleSetInstrumentModelFilters,
    platformResults: platformFilterResults,
    selectedPlatformFilters,
    setSelectedPlatformFilters: handleSetPlatformFilters,
    multiPlatformOnly,
    setMultiPlatformOnly: handleSetMultiPlatform,
    onClearMoreFilters: handleClearMoreFilters,
  };

  const hasAnyFilter =
    selectedOrganismKey != null ||
    selectedJournalFilters.length > 0 ||
    selectedCountryFilters.length > 0 ||
    selectedLibraryStrategyFilters.length > 0 ||
    selectedInstrumentModelFilters.length > 0 ||
    selectedPlatformFilters.length > 0 ||
    multiPlatformOnly ||
    timeFilter !== "any" ||
    sortBy !== "relevance" ||
    db != null;

  const resetSort = useCallback(
    () => updateSearchUrl({ [FILTER_PARAM_KEYS.sortBy]: null }),
    [updateSearchUrl],
  );
  const resetTime = useCallback(
    () =>
      updateSearchUrl({
        [FILTER_PARAM_KEYS.time]: null,
        [FILTER_PARAM_KEYS.yearFrom]: null,
        [FILTER_PARAM_KEYS.yearTo]: null,
      }),
    [updateSearchUrl],
  );
  const resetDb = useCallback(
    () => handleDatabaseChange("both"),
    [handleDatabaseChange],
  );
  const resetOrganism = useCallback(
    () => updateSearchUrl({ [FILTER_PARAM_KEYS.organism]: null }),
    [updateSearchUrl],
  );
  const handleClearAllFilters = useCallback(() => {
    updateSearchUrl({
      [FILTER_PARAM_KEYS.sortBy]: null,
      [FILTER_PARAM_KEYS.time]: null,
      [FILTER_PARAM_KEYS.yearFrom]: null,
      [FILTER_PARAM_KEYS.yearTo]: null,
      [FILTER_PARAM_KEYS.organism]: null,
      [FILTER_PARAM_KEYS.journal]: [],
      [FILTER_PARAM_KEYS.country]: [],
      [FILTER_PARAM_KEYS.libraryStrategy]: [],
      [FILTER_PARAM_KEYS.instrumentModel]: [],
      [FILTER_PARAM_KEYS.platform]: [],
      [FILTER_PARAM_KEYS.multiPlatform]: null,
    });
    if (db) handleDatabaseChange("both");
  }, [updateSearchUrl, db, handleDatabaseChange]);

  const filterToolbar = (
    <SearchFilters
      db={db}
      query={query}
      sortBy={sortBy}
      setSortBy={(value) =>
        updateSearchUrl({
          [FILTER_PARAM_KEYS.sortBy]: value === "relevance" ? null : value,
        })
      }
      setTimeFilter={(value) =>
        updateSearchUrl({
          [FILTER_PARAM_KEYS.time]: value === "any" ? null : value,
          [FILTER_PARAM_KEYS.yearFrom]:
            value === "custom" ? customYearRange.from : null,
          [FILTER_PARAM_KEYS.yearTo]:
            value === "custom" ? customYearRange.to : null,
        })
      }
      timeFilter={timeFilter}
      customYearRange={customYearRange}
      setCustomYearRange={(value) =>
        updateSearchUrl({
          [FILTER_PARAM_KEYS.time]: "custom",
          [FILTER_PARAM_KEYS.yearFrom]: value.from,
          [FILTER_PARAM_KEYS.yearTo]: value.to,
        })
      }
      onDatabaseChange={handleDatabaseChange}
    />
  );

  const activeFilterChips = (
    <ActiveFilterChips
      sortBy={sortBy}
      onResetSort={resetSort}
      timeFilter={timeFilter}
      customYearRange={customYearRange}
      onResetTime={resetTime}
      db={db}
      onResetDb={resetDb}
      selectedOrganismKey={selectedOrganismKey}
      onResetOrganism={resetOrganism}
      selectedJournalFilters={selectedJournalFilters}
      setSelectedJournalFilters={handleSetJournalFilters}
      selectedCountryFilters={selectedCountryFilters}
      setSelectedCountryFilters={handleSetCountryFilters}
      selectedLibraryStrategyFilters={selectedLibraryStrategyFilters}
      setSelectedLibraryStrategyFilters={handleSetLibraryStrategyFilters}
      selectedInstrumentModelFilters={selectedInstrumentModelFilters}
      setSelectedInstrumentModelFilters={handleSetInstrumentModelFilters}
      selectedPlatformFilters={selectedPlatformFilters}
      setSelectedPlatformFilters={handleSetPlatformFilters}
      multiPlatformOnly={multiPlatformOnly}
      setMultiPlatformOnly={handleSetMultiPlatform}
      onClearAll={handleClearAllFilters}
    />
  );

  return (
    <>
      <SearchBar initialQuery={query} />

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="seqout-sr-only"
      >
        {announcedStatus}
      </div>

      <Flex
        gap={"4"}
        px={{ initial: "0", md: "4" }}
        width={{ initial: "98%", md: "100%" }}
        mx="auto"
        justify={{ initial: "start", md: "between" }}
        direction={{ initial: "column", md: "row" }}
      >
        {shouldShowOrganismRail ? (
          <SearchOrganismRail {...railProps} showMobile showDesktop={false} />
        ) : null}

        <Flex
          gap="4"
          direction="column"
          width={{ initial: "100%", md: "calc(100% - 240px)", lg: "calc(100% - 300px)" }}
          minWidth="0"
        >
          {activeFilterChips}
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
              role="alert"
              gap="3"
              align="center"
              justify="center"
              height={"20rem"}
              direction={"column"}
            >
              <Text size={{ initial: "5", md: "6" }} weight="bold">
                We couldn&rsquo;t reach the search server
              </Text>
              <Text
                size="2"
                align="center"
                style={{ color: "var(--gray-11)", maxWidth: "32rem" }}
              >
                The server may be under load, or the connection may have
                dropped. Your query is still in the URL — retrying is safe.
              </Text>
              <Flex gap="2" align="center" mt="1">
                <Button variant="surface" onClick={() => refetch()}>
                  <ReloadIcon /> Retry search
                </Button>
              </Flex>
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
                {filterToolbar}
              </Flex>

              {suggestions?.length ? (
                <DidYouMean
                  suggestion={suggestions[0]}
                  searchParams={searchParams}
                  onNavigate={(url) => router.push(url)}
                />
              ) : null}

              {pageResults.length === 0 ? (
                <Flex
                  align="center"
                  justify="center"
                  direction={"column"}
                  height={"12rem"}
                  gap="2"
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
                      <Text size={{ initial: "3", md: "4" }} weight="bold">
                        No results match your filters
                      </Text>
                      <Text
                        size="2"
                        align="center"
                        style={{ color: "var(--gray-11)" }}
                      >
                        {filteredTotal === 0 && allResults.length > 0
                          ? `${allResults.length.toLocaleString()} result${allResults.length === 1 ? "" : "s"} were filtered out — try removing a filter to see them.`
                          : "Try clearing active filters or widening the time range."}
                      </Text>
                      {hasAnyFilter && (
                        <Button
                          variant="surface"
                          size="2"
                          onClick={handleClearAllFilters}
                          mt="1"
                        >
                          Clear all filters
                        </Button>
                      )}
                    </>
                  )}
                </Flex>
              ) : (
                <Flex
                  ref={resultsListRef}
                  direction="column"
                  gap="0"
                  className="seqout-divided-list"
                  style={{ paddingLeft: 0 }}
                >
                  {pageResults.map((searchResult) => (
                    <ResultCard
                      key={`${searchResult.source}:${searchResult.accession}`}
                      accession={searchResult.accession}
                      title={searchResult.title}
                      summary={searchResult.summary}
                      updated_at={searchResult.updated_at}
                      journal={searchResult.journal}
                      doi={searchResult.doi}
                      citation_count={searchResult.citation_count}
                      authors={searchResult.authors}
                      center_name={searchResult.center_name}
                      country_code={searchResult.country_code}
                      single_cell_modality={searchResult.single_cell_modality}
                      href={selectedOrganismKey
                        ? `${getProjectShortUrl(searchResult.accession)}?organism=${encodeURIComponent(selectedOrganismKey)}`
                        : undefined}
                    />
                  ))}
                </Flex>
              )}

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
              gap="3"
            >
              <Text size={{ initial: "5", md: "6" }} weight="bold">
                {query
                  ? <>No results for &ldquo;{query}&rdquo;</>
                  : "No results found"}
              </Text>
              {suggestions?.length ? (
                <DidYouMean
                  suggestion={suggestions[0]}
                  searchParams={searchParams}
                  onNavigate={(url) => router.push(url)}
                />
              ) : (
                <Text
                  size="2"
                  align="center"
                  style={{ color: "var(--gray-11)", maxWidth: "32rem" }}
                >
                  Try a different keyword, broaden your filters, or search by
                  accession (e.g.&nbsp;
                  <span className="seqout-accession">GSE196830</span>).
                </Text>
              )}
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
                  aria-label="Go back to top"
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
              <Button
                onClick={handleDownloadResults}
                disabled={isDownloading}
                aria-busy={isDownloading}
              >
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
