"use client";

import { OrganismFilter, OrganismNameMode } from "@/components/organism_filter";
import type { SortBy } from "@/components/search-page-body";
import { SearchResult } from "@/utils/types";
import {
  CrumpledPaperIcon,
  InfoCircledIcon,
  MagnifyingGlassIcon,
  MixerHorizontalIcon,
} from "@radix-ui/react-icons";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Flex,
  Select,
  Separator,
  Tabs,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { useState } from "react";

countries.registerLocale(enLocale);

const PLATFORM_DISPLAY: Record<string, string> = {
  ILLUMINA: "Illumina",
  OXFORD_NANOPORE: "Oxford Nanopore",
  PACBIO_SMRT: "PacBio",
  ION_TORRENT: "Ion Torrent",
  DNBSEQ: "DNBSEQ (MGI)",
  BGISEQ: "BGISEQ (MGI)",
  ELEMENT: "Element Biosciences",
  ABI_SOLID: "SOLiD",
  COMPLETE_GENOMICS: "Complete Genomics",
  LS454: "454 Life Sciences",
  HELICOS: "Helicos",
  ULTIMA: "Ultima Genomics",
  GENEMIND: "GeneMind",
  CAPILLARY: "Capillary",
  VELA_DIAGNOSTICS: "Vela Diagnostics",
  TAPESTRI: "Tapestri",
  GENAPSYS: "GenapSys",
  SINGULAR_GENOMICS: "Singular Genomics",
};

type TimeFilter = "any" | "1" | "5" | "10" | "20" | "custom";

type SearchFiltersProps = {
  db: string | null;
  query: string | null;
  sortBy: SortBy;
  setSortBy: (value: SortBy) => void;
  setTimeFilter: (value: TimeFilter) => void;
  timeFilter: TimeFilter;
  customYearRange: { from: string; to: string };
  setCustomYearRange: (value: { from: string; to: string }) => void;
  onDatabaseChange: (value: "geo" | "sra" | "arrayexpress" | "both") => void;
};

export function SearchFilters({
  db,
  query,
  sortBy,
  setSortBy,
  setTimeFilter,
  timeFilter,
  customYearRange,
  setCustomYearRange,
  onDatabaseChange,
}: SearchFiltersProps) {
  const currentYear = new Date().getFullYear();

  return (
    <Flex
      direction="row"
      gap="2"
      wrap="wrap"
      align="center"
      aria-label="Search filters"
    >
      <Select.Root
        value={sortBy}
        name="sort"
        onValueChange={(value) => setSortBy(value as SortBy)}
        size="1"
      >
        <Select.Trigger aria-label="Sort by" />
        <Select.Content>
          <Select.Group>
            <Select.Item value="relevance">Sort by relevance</Select.Item>
            <Select.Item value="date">Sort by date</Select.Item>
            <Select.Item value="citations">Sort by citations</Select.Item>
            <Select.Item value="journal">Sort by journal</Select.Item>
          </Select.Group>
        </Select.Content>
      </Select.Root>

      <Select.Root
        value={timeFilter}
        name="time"
        onValueChange={(value) => setTimeFilter(value as TimeFilter)}
        size="1"
      >
        <Select.Trigger aria-label="Time range" />
        <Select.Content>
          <Select.Group>
            <Select.Item value="any">Any time</Select.Item>
            <Select.Item value="1">Last year</Select.Item>
            <Select.Item value="5">Last 5 years</Select.Item>
            <Select.Item value="10">Last 10 years</Select.Item>
            <Select.Item value="20">Last 20 years</Select.Item>
            <Select.Item value="custom">Custom range</Select.Item>
          </Select.Group>
        </Select.Content>
      </Select.Root>

      <Select.Root
        value={db ? db : "both"}
        onValueChange={(value) => {
          if (!query) return;
          onDatabaseChange(value as "geo" | "sra" | "arrayexpress" | "both");
        }}
        size="1"
      >
        <Select.Trigger aria-label="Source database" />
        <Select.Content>
          <Select.Group>
            <Select.Item value="both">All sources</Select.Item>
            <Select.Item value="geo">GEO only</Select.Item>
            <Select.Item value="sra">SRA only</Select.Item>
            <Select.Item value="arrayexpress">ArrayExpress only</Select.Item>
          </Select.Group>
        </Select.Content>
      </Select.Root>

      {timeFilter === "custom" && (
        <Flex gap="2" align="center">
          <TextField.Root
            type="number"
            min="2000"
            max={currentYear}
            value={customYearRange.from}
            onChange={(e) =>
              setCustomYearRange({ ...customYearRange, from: e.target.value })
            }
            onBlur={() =>
              setCustomYearRange(
                normalizeYearRange(customYearRange, currentYear),
              )
            }
            placeholder="YYYY"
            variant="surface"
            size="1"
            style={{ width: "4.5rem" }}
            aria-label="Year from"
          />
          <Text size="2" color="gray">
            to
          </Text>
          <TextField.Root
            type="number"
            min="2000"
            max={currentYear}
            value={customYearRange.to}
            onChange={(e) =>
              setCustomYearRange({ ...customYearRange, to: e.target.value })
            }
            onBlur={() =>
              setCustomYearRange(
                normalizeYearRange(customYearRange, currentYear),
              )
            }
            placeholder="YYYY"
            variant="surface"
            size="1"
            style={{ width: "4.5rem" }}
            aria-label="Year to"
          />
        </Flex>
      )}
    </Flex>
  );
}

/**
 * Normalize a year-range pair on blur:
 *   1. Clamp each non-empty value to [2000, currentYear]
 *   2. If both values are present and inverted (from > to), swap them
 *
 * Empty inputs are left empty so users can still set a single open-ended
 * bound. Returns the same object identity if nothing changed, so the
 * setCustomYearRange call doesn't trigger an unnecessary URL update.
 */
function normalizeYearRange(
  range: { from: string; to: string },
  maxYear: number,
): { from: string; to: string } {
  const minYear = 2000;
  const clamp = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n)) return "";
    if (n < minYear) return String(minYear);
    if (n > maxYear) return String(maxYear);
    return String(n);
  };

  let from = clamp(range.from);
  let to = clamp(range.to);

  // Auto-swap if both bounds are set and inverted.
  if (from && to && Number.parseInt(from, 10) > Number.parseInt(to, 10)) {
    [from, to] = [to, from];
  }

  if (from === range.from && to === range.to) return range;
  return { from, to };
}

export function SearchOrganismRail({
  results,
  journalResults,
  countryResults,
  libraryStrategyResults,
  instrumentModelResults,
  platformResults,
  organismNameMode,
  setOrganismNameMode,
  selectedOrganismKey,
  setSelectedOrganismFilter,
  selectedJournalFilters,
  setSelectedJournalFilters,
  selectedCountryFilters,
  setSelectedCountryFilters,
  selectedLibraryStrategyFilters,
  setSelectedLibraryStrategyFilters,
  selectedInstrumentModelFilters,
  setSelectedInstrumentModelFilters,
  selectedPlatformFilters,
  setSelectedPlatformFilters,
  multiPlatformOnly,
  setMultiPlatformOnly,
  onClearMoreFilters,
  showMobile = false,
  showDesktop = true,
}: {
  results: SearchResult[];
  journalResults: SearchResult[];
  countryResults: SearchResult[];
  libraryStrategyResults: SearchResult[];
  instrumentModelResults: SearchResult[];
  platformResults: SearchResult[];
  organismNameMode: OrganismNameMode;
  setOrganismNameMode: (value: OrganismNameMode) => void;
  selectedOrganismKey: string | null;
  setSelectedOrganismFilter: (value: string | null) => void;
  selectedJournalFilters: string[];
  setSelectedJournalFilters: (value: string[]) => void;
  selectedCountryFilters: string[];
  setSelectedCountryFilters: (value: string[]) => void;
  selectedLibraryStrategyFilters: string[];
  setSelectedLibraryStrategyFilters: (value: string[]) => void;
  selectedInstrumentModelFilters: string[];
  setSelectedInstrumentModelFilters: (value: string[]) => void;
  selectedPlatformFilters: string[];
  setSelectedPlatformFilters: (value: string[]) => void;
  multiPlatformOnly: boolean;
  setMultiPlatformOnly: (value: boolean) => void;
  onClearMoreFilters: () => void;
  showMobile?: boolean;
  showDesktop?: boolean;
}) {
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [organismsOpen, setOrganismsOpen] = useState(false);
  const [journalQuery, setJournalQuery] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [libraryStrategyQuery, setLibraryStrategyQuery] = useState("");
  const [instrumentModelQuery, setInstrumentModelQuery] = useState("");

  const journalCounts = new Map<string, number>();
  for (const result of journalResults) {
    const journal = result.journal?.trim();
    if (!journal) continue;
    journalCounts.set(journal, (journalCounts.get(journal) ?? 0) + 1);
  }

  const journalOptions = Array.from(journalCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const normalizedJournalQuery = journalQuery.trim().toLowerCase();
  const visibleJournalOptions = normalizedJournalQuery
    ? journalOptions.filter((option) =>
        option.name.toLowerCase().includes(normalizedJournalQuery),
      )
    : journalOptions;

  const toggleJournalSelection = (journal: string) => {
    if (selectedJournalFilters.includes(journal)) {
      setSelectedJournalFilters(
        selectedJournalFilters.filter((value) => value !== journal),
      );
      return;
    }
    setSelectedJournalFilters([...selectedJournalFilters, journal]);
  };

  const countryCounts = new Map<string, number>();
  for (const result of countryResults) {
    for (const countryCode of result.countries ?? []) {
      const country = countryCode.trim().toUpperCase();
      if (!country) continue;
      countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    }
  }

  const countryOptions = Array.from(countryCounts.entries())
    .map(([code, count]) => ({
      code,
      label: countries.getName(code, "en", { select: "official" }) ?? code,
      count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const normalizedCountryQuery = countryQuery.trim().toLowerCase();
  const visibleCountryOptions = normalizedCountryQuery
    ? countryOptions.filter(
        (option) =>
          option.label.toLowerCase().includes(normalizedCountryQuery) ||
          option.code.toLowerCase().includes(normalizedCountryQuery),
      )
    : countryOptions;

  const toggleCountrySelection = (countryCode: string) => {
    if (selectedCountryFilters.includes(countryCode)) {
      setSelectedCountryFilters(
        selectedCountryFilters.filter((value) => value !== countryCode),
      );
      return;
    }
    setSelectedCountryFilters([...selectedCountryFilters, countryCode]);
  };

  const libraryStrategyCounts = new Map<string, number>();
  for (const result of libraryStrategyResults) {
    for (const strategyValue of result.library_strategies ?? []) {
      const strategy = strategyValue.trim();
      if (!strategy) continue;
      libraryStrategyCounts.set(
        strategy,
        (libraryStrategyCounts.get(strategy) ?? 0) + 1,
      );
    }
  }

  const libraryStrategyOptions = Array.from(libraryStrategyCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const normalizedLibraryStrategyQuery = libraryStrategyQuery
    .trim()
    .toLowerCase();
  const visibleLibraryStrategyOptions = normalizedLibraryStrategyQuery
    ? libraryStrategyOptions.filter((option) =>
        option.name.toLowerCase().includes(normalizedLibraryStrategyQuery),
      )
    : libraryStrategyOptions;

  const toggleLibraryStrategySelection = (strategy: string) => {
    if (selectedLibraryStrategyFilters.includes(strategy)) {
      setSelectedLibraryStrategyFilters(
        selectedLibraryStrategyFilters.filter((value) => value !== strategy),
      );
      return;
    }
    setSelectedLibraryStrategyFilters([
      ...selectedLibraryStrategyFilters,
      strategy,
    ]);
  };

  const instrumentModelCounts = new Map<string, number>();
  for (const result of instrumentModelResults) {
    for (const modelValue of result.instrument_models ?? []) {
      const model = modelValue.trim();
      if (!model) continue;
      instrumentModelCounts.set(
        model,
        (instrumentModelCounts.get(model) ?? 0) + 1,
      );
    }
  }

  const instrumentModelOptions = Array.from(instrumentModelCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const normalizedInstrumentModelQuery = instrumentModelQuery
    .trim()
    .toLowerCase();
  const visibleInstrumentModelOptions = normalizedInstrumentModelQuery
    ? instrumentModelOptions.filter((option) =>
        option.name.toLowerCase().includes(normalizedInstrumentModelQuery),
      )
    : instrumentModelOptions;

  const toggleInstrumentModelSelection = (model: string) => {
    if (selectedInstrumentModelFilters.includes(model)) {
      setSelectedInstrumentModelFilters(
        selectedInstrumentModelFilters.filter((value) => value !== model),
      );
      return;
    }
    setSelectedInstrumentModelFilters([
      ...selectedInstrumentModelFilters,
      model,
    ]);
  };

  const platformCounts = new Map<string, number>();
  for (const result of platformResults) {
    for (const p of result.platforms ?? []) {
      const plat = p.trim();
      if (!plat) continue;
      platformCounts.set(plat, (platformCounts.get(plat) ?? 0) + 1);
    }
  }

  const platformOptions = Array.from(platformCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const [platformQuery, setPlatformQuery] = useState("");
  const normalizedPlatformQuery = platformQuery.trim().toLowerCase();
  const visiblePlatformOptions = normalizedPlatformQuery
    ? platformOptions.filter((option) =>
        (PLATFORM_DISPLAY[option.name] ?? option.name)
          .toLowerCase()
          .includes(normalizedPlatformQuery),
      )
    : platformOptions;

  const togglePlatformSelection = (platform: string) => {
    if (selectedPlatformFilters.includes(platform)) {
      setSelectedPlatformFilters(
        selectedPlatformFilters.filter((value) => value !== platform),
      );
      return;
    }
    setSelectedPlatformFilters([...selectedPlatformFilters, platform]);
  };

  const selectedFilterCount =
    selectedJournalFilters.length +
    selectedCountryFilters.length +
    selectedLibraryStrategyFilters.length +
    selectedInstrumentModelFilters.length +
    selectedPlatformFilters.length +
    (multiPlatformOnly ? 1 : 0);

  return (
    <>
      {showMobile ? (
        <Flex display={{ initial: "flex", md: "none" }} direction="column" gap="2" align="end">
          <Dialog.Root open={organismsOpen} onOpenChange={setOrganismsOpen}>
            <Dialog.Trigger>
              <Button>
                <MixerHorizontalIcon />
                Organisms
              </Button>
            </Dialog.Trigger>
            <Dialog.Content
              size="2"
              style={{
                width: "calc(100vw - 1rem)",
                maxWidth: "calc(100vw - 1rem)",
              }}
            >
              <Dialog.Title>Organisms</Dialog.Title>
              <Dialog.Description size="1">
                Narrow results by organism.
              </Dialog.Description>
              <Flex
                mt="3"
                width="100%"
                style={{ height: "24rem", overflowY: "auto" }}
              >
                <div style={{ width: "100%" }}>
                  <OrganismFilter
                    results={results}
                    mode={organismNameMode}
                    onChangeMode={setOrganismNameMode}
                    selectedKey={selectedOrganismKey}
                    onChangeSelection={setSelectedOrganismFilter}
                  />
                </div>
              </Flex>
            </Dialog.Content>
          </Dialog.Root>

          <Dialog.Root open={moreFiltersOpen} onOpenChange={setMoreFiltersOpen}>
            <Dialog.Trigger>
              <Button>
                <MixerHorizontalIcon />
                More filters
              </Button>
            </Dialog.Trigger>
            <Dialog.Content
              size="3"
              style={{
                width: "calc(100vw - 1rem)",
                maxWidth: "calc(100vw - 1rem)",
              }}
            >
              <Dialog.Title>
                <Flex align={"center"} justify={"between"}>
                  <Flex align={"center"} gap={"2"}>
                    <Text>More filters</Text>
                    <Badge color="teal">Beta</Badge>
                  </Flex>
                  <Button
                    size={"1"}
                    color="red"
                    disabled={selectedFilterCount === 0}
                    onClick={onClearMoreFilters}
                  >
                    <CrumpledPaperIcon /> Clear
                  </Button>
                </Flex>
              </Dialog.Title>

              <Tabs.Root
                defaultValue="journals"
                style={{ marginTop: "0.5rem" }}
              >
                <Tabs.List
                  style={{
                    overflowX: "auto",
                    maxWidth: "100%",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Tabs.Trigger value="journals">
                    <Flex align="center" gap="1">
                      <span>Journals</span>
                      {selectedJournalFilters.length > 0 ? (
                        <Badge>{selectedJournalFilters.length}</Badge>
                      ) : null}
                    </Flex>
                  </Tabs.Trigger>
                  <Tabs.Trigger value="countries">
                    <Flex align="center" gap="1">
                      <span>Countries</span>
                      {selectedCountryFilters.length > 0 ? (
                        <Badge>{selectedCountryFilters.length}</Badge>
                      ) : null}
                    </Flex>
                  </Tabs.Trigger>
                  <Tabs.Trigger value="library-strategy">
                    <Flex align="center" gap="1">
                      <span>Library Strategy</span>
                      <Tooltip content="The sequencing approach used in the experiment — e.g. RNA-Seq, ChIP-Seq, Whole Genome, ATAC-Seq, or Bisulfite-Seq.">
                        <InfoCircledIcon
                          width="13"
                          height="13"
                          style={{ opacity: 0.6 }}
                        />
                      </Tooltip>
                      {selectedLibraryStrategyFilters.length > 0 ? (
                        <Badge>{selectedLibraryStrategyFilters.length}</Badge>
                      ) : null}
                    </Flex>
                  </Tabs.Trigger>
                  <Tabs.Trigger value="instrument-models">
                    <Flex align="center" gap="1">
                      <span>Instrument Models</span>
                      {selectedInstrumentModelFilters.length > 0 ? (
                        <Badge>{selectedInstrumentModelFilters.length}</Badge>
                      ) : null}
                    </Flex>
                  </Tabs.Trigger>
                  <Tabs.Trigger value="platform">
                    <Flex align="center" gap="1">
                      <span>Platform</span>
                      {selectedPlatformFilters.length > 0 || multiPlatformOnly ? (
                        <Badge>{selectedPlatformFilters.length + (multiPlatformOnly ? 1 : 0)}</Badge>
                      ) : null}
                    </Flex>
                  </Tabs.Trigger>
                </Tabs.List>

                <Tabs.Content value="journals">
                  <Flex direction="column" gap="3" pt="3">
                    <TextField.Root
                      value={journalQuery}
                      onChange={(event) => setJournalQuery(event.target.value)}
                      placeholder="Search journals"
                      aria-label="Search journals"
                      size="2"
                    >
                      <TextField.Slot>
                        <MagnifyingGlassIcon height="16" width="16" />
                      </TextField.Slot>
                    </TextField.Root>
                    {visibleJournalOptions.length > 0 ? (
                      <Flex
                        direction="column"
                        gap="2"
                        style={{ maxHeight: "16rem", overflowY: "auto" }}
                      >
                        {visibleJournalOptions.map((journalOption) => (
                          <Text as="label" size="2" key={journalOption.name}>
                            <Flex align="center" justify="between" gap="2">
                              <Flex align="center" gap="2">
                                <Checkbox
                                  checked={selectedJournalFilters.includes(
                                    journalOption.name,
                                  )}
                                  onCheckedChange={() =>
                                    toggleJournalSelection(journalOption.name)
                                  }
                                />
                                <span>{journalOption.name}</span>
                              </Flex>
                              <Badge color="gray" variant="soft">
                                {journalOption.count}
                              </Badge>
                            </Flex>
                          </Text>
                        ))}
                      </Flex>
                    ) : (
                      <Text size="2" color="gray">
                        No journals found.
                      </Text>
                    )}
                  </Flex>
                </Tabs.Content>

                <Tabs.Content value="countries">
                  <Flex direction="column" gap="3" pt="3">
                    <TextField.Root
                      value={countryQuery}
                      onChange={(event) => setCountryQuery(event.target.value)}
                      placeholder="Search countries"
                      aria-label="Search countries"
                      size="2"
                    >
                      <TextField.Slot>
                        <MagnifyingGlassIcon height="16" width="16" />
                      </TextField.Slot>
                    </TextField.Root>
                    {visibleCountryOptions.length > 0 ? (
                      <Flex
                        direction="column"
                        gap="2"
                        style={{ maxHeight: "16rem", overflowY: "auto" }}
                      >
                        {visibleCountryOptions.map((countryOption) => (
                          <Text as="label" size="2" key={countryOption.code}>
                            <Flex align="center" justify="between" gap="2">
                              <Flex align="center" gap="2">
                                <Checkbox
                                  checked={selectedCountryFilters.includes(
                                    countryOption.code,
                                  )}
                                  onCheckedChange={() =>
                                    toggleCountrySelection(countryOption.code)
                                  }
                                />
                                <span>{countryOption.label}</span>
                              </Flex>
                              <Badge color="gray" variant="soft">
                                {countryOption.count}
                              </Badge>
                            </Flex>
                          </Text>
                        ))}
                      </Flex>
                    ) : (
                      <Text size="2" color="gray">
                        No countries found.
                      </Text>
                    )}
                  </Flex>
                </Tabs.Content>

                <Tabs.Content value="library-strategy">
                  <Flex direction="column" gap="3" pt="3">
                    <TextField.Root
                      value={libraryStrategyQuery}
                      onChange={(event) =>
                        setLibraryStrategyQuery(event.target.value)
                      }
                      placeholder="Search library strategies"
                      aria-label="Search library strategies"
                      size="2"
                    >
                      <TextField.Slot>
                        <MagnifyingGlassIcon height="16" width="16" />
                      </TextField.Slot>
                    </TextField.Root>
                    {visibleLibraryStrategyOptions.length > 0 ? (
                      <Flex
                        direction="column"
                        gap="2"
                        style={{ maxHeight: "16rem", overflowY: "auto" }}
                      >
                        {visibleLibraryStrategyOptions.map(
                          (libraryStrategyOption) => (
                            <Text
                              as="label"
                              size="2"
                              key={libraryStrategyOption.name}
                            >
                              <Flex align="center" justify="between" gap="2">
                                <Flex align="center" gap="2">
                                  <Checkbox
                                    checked={selectedLibraryStrategyFilters.includes(
                                      libraryStrategyOption.name,
                                    )}
                                    onCheckedChange={() =>
                                      toggleLibraryStrategySelection(
                                        libraryStrategyOption.name,
                                      )
                                    }
                                  />
                                  <span>{libraryStrategyOption.name}</span>
                                </Flex>
                                <Badge color="gray" variant="soft">
                                  {libraryStrategyOption.count}
                                </Badge>
                              </Flex>
                            </Text>
                          ),
                        )}
                      </Flex>
                    ) : (
                      <Text size="2" color="gray">
                        No library strategies found.
                      </Text>
                    )}
                  </Flex>
                </Tabs.Content>

                <Tabs.Content value="instrument-models">
                  <Flex direction="column" gap="3" pt="3">
                    <TextField.Root
                      value={instrumentModelQuery}
                      onChange={(event) =>
                        setInstrumentModelQuery(event.target.value)
                      }
                      placeholder="Search instrument models"
                      aria-label="Search instrument models"
                      size="2"
                    >
                      <TextField.Slot>
                        <MagnifyingGlassIcon height="16" width="16" />
                      </TextField.Slot>
                    </TextField.Root>
                    {visibleInstrumentModelOptions.length > 0 ? (
                      <Flex
                        direction="column"
                        gap="2"
                        style={{ maxHeight: "16rem", overflowY: "auto" }}
                      >
                        {visibleInstrumentModelOptions.map(
                          (instrumentModelOption) => (
                            <Text
                              as="label"
                              size="2"
                              key={instrumentModelOption.name}
                            >
                              <Flex align="center" justify="between" gap="2">
                                <Flex align="center" gap="2">
                                  <Checkbox
                                    checked={selectedInstrumentModelFilters.includes(
                                      instrumentModelOption.name,
                                    )}
                                    onCheckedChange={() =>
                                      toggleInstrumentModelSelection(
                                        instrumentModelOption.name,
                                      )
                                    }
                                  />
                                  <span>{instrumentModelOption.name}</span>
                                </Flex>
                                <Badge color="gray" variant="soft">
                                  {instrumentModelOption.count}
                                </Badge>
                              </Flex>
                            </Text>
                          ),
                        )}
                      </Flex>
                    ) : (
                      <Text size="2" color="gray">
                        No instrument models found.
                      </Text>
                    )}
                  </Flex>
                </Tabs.Content>

                <Tabs.Content value="platform">
                  <Flex direction="column" gap="3" pt="3">
                    <Text as="label" size="2">
                      <Flex align="center" gap="2">
                        <Checkbox
                          checked={multiPlatformOnly}
                          onCheckedChange={(checked) =>
                            setMultiPlatformOnly(checked === true)
                          }
                        />
                        <span>Multi-platform studies only</span>
                        <Tooltip content="Studies that sequenced the same samples on 2+ platforms (e.g. Illumina + Oxford Nanopore). Useful for benchmarking or hybrid assembly papers.">
                          <InfoCircledIcon
                            width="13"
                            height="13"
                            style={{ opacity: 0.6 }}
                          />
                        </Tooltip>
                      </Flex>
                    </Text>
                    <Separator size="4" />
                    <TextField.Root
                      value={platformQuery}
                      onChange={(event) =>
                        setPlatformQuery(event.target.value)
                      }
                      placeholder="Search platforms"
                      aria-label="Search platforms"
                      size="2"
                    >
                      <TextField.Slot>
                        <MagnifyingGlassIcon height="16" width="16" />
                      </TextField.Slot>
                    </TextField.Root>
                    {visiblePlatformOptions.length > 0 ? (
                      <Flex
                        direction="column"
                        gap="2"
                        style={{ maxHeight: "16rem", overflowY: "auto" }}
                      >
                        {visiblePlatformOptions.map((platformOption) => (
                          <Text
                            as="label"
                            size="2"
                            key={platformOption.name}
                          >
                            <Flex align="center" justify="between" gap="2">
                              <Flex align="center" gap="2">
                                <Checkbox
                                  checked={selectedPlatformFilters.includes(
                                    platformOption.name,
                                  )}
                                  onCheckedChange={() =>
                                    togglePlatformSelection(platformOption.name)
                                  }
                                />
                                <span>
                                  {PLATFORM_DISPLAY[platformOption.name] ??
                                    platformOption.name}
                                </span>
                              </Flex>
                              <Badge color="gray" variant="soft">
                                {platformOption.count}
                              </Badge>
                            </Flex>
                          </Text>
                        ))}
                      </Flex>
                    ) : (
                      <Text size="2" color="gray">
                        No platforms found.
                      </Text>
                    )}
                  </Flex>
                </Tabs.Content>
              </Tabs.Root>
            </Dialog.Content>
          </Dialog.Root>
        </Flex>
      ) : null}

      {showDesktop ? (
        <Flex
          display={{ initial: "none", md: "flex" }}
          direction="column"
          gap="2"
          width={{ md: "220px", lg: "280px" }}
          position="sticky"
          style={{ top: "6rem", height: "fit-content" }}
        >
          <OrganismFilter
            results={results}
            mode={organismNameMode}
            onChangeMode={setOrganismNameMode}
            selectedKey={selectedOrganismKey}
            onChangeSelection={setSelectedOrganismFilter}
          />
          <Dialog.Root open={moreFiltersOpen} onOpenChange={setMoreFiltersOpen}>
            <Dialog.Trigger>
              <Button variant="surface">
                <MixerHorizontalIcon />
                More filters
                {selectedFilterCount > 0 ? (
                  <Badge color="blue">{selectedFilterCount}</Badge>
                ) : null}
              </Button>
            </Dialog.Trigger>
            <Dialog.Content size="3">
              <Dialog.Title>
                <Flex align={"center"} justify={"between"}>
                  <Flex align={"center"} gap={"2"}>
                    <Text>More filters</Text>
                    <Badge color="teal">Beta</Badge>
                  </Flex>
                  <Button
                    size={"1"}
                    color="red"
                    disabled={selectedFilterCount === 0}
                    onClick={onClearMoreFilters}
                  >
                    <CrumpledPaperIcon /> Clear
                  </Button>
                </Flex>
              </Dialog.Title>

              <Tabs.Root
                defaultValue="journals"
                style={{ marginTop: "0.5rem" }}
              >
                <Tabs.List>
                  <Tabs.Trigger value="journals">
                    <Flex align="center" gap="1">
                      <span>Journals</span>
                      {selectedJournalFilters.length > 0 ? (
                        <Badge>{selectedJournalFilters.length}</Badge>
                      ) : null}
                    </Flex>
                  </Tabs.Trigger>
                  <Tabs.Trigger value="countries">
                    <Flex align="center" gap="1">
                      <span>Countries</span>
                      {selectedCountryFilters.length > 0 ? (
                        <Badge>{selectedCountryFilters.length}</Badge>
                      ) : null}
                    </Flex>
                  </Tabs.Trigger>
                  <Tabs.Trigger value="library-strategy">
                    <Flex align="center" gap="1">
                      <span>Library Strategy</span>
                      <Tooltip content="The sequencing approach used in the experiment — e.g. RNA-Seq, ChIP-Seq, Whole Genome, ATAC-Seq, or Bisulfite-Seq.">
                        <InfoCircledIcon
                          width="13"
                          height="13"
                          style={{ opacity: 0.6 }}
                        />
                      </Tooltip>
                      {selectedLibraryStrategyFilters.length > 0 ? (
                        <Badge>{selectedLibraryStrategyFilters.length}</Badge>
                      ) : null}
                    </Flex>
                  </Tabs.Trigger>
                  <Tabs.Trigger value="instrument-models">
                    <Flex align="center" gap="1">
                      <span>Instrument Models</span>
                      {selectedInstrumentModelFilters.length > 0 ? (
                        <Badge>{selectedInstrumentModelFilters.length}</Badge>
                      ) : null}
                    </Flex>
                  </Tabs.Trigger>
                  <Tabs.Trigger value="platform">
                    <Flex align="center" gap="1">
                      <span>Platform</span>
                      {selectedPlatformFilters.length > 0 || multiPlatformOnly ? (
                        <Badge>{selectedPlatformFilters.length + (multiPlatformOnly ? 1 : 0)}</Badge>
                      ) : null}
                    </Flex>
                  </Tabs.Trigger>
                </Tabs.List>

                <Tabs.Content value="journals">
                  <Flex direction="column" gap="3" pt="3">
                    <TextField.Root
                      value={journalQuery}
                      onChange={(event) => setJournalQuery(event.target.value)}
                      placeholder="Search journals"
                      aria-label="Search journals"
                      size="2"
                    >
                      <TextField.Slot>
                        <MagnifyingGlassIcon height="16" width="16" />
                      </TextField.Slot>
                    </TextField.Root>
                    {visibleJournalOptions.length > 0 ? (
                      <Flex
                        direction="column"
                        gap="2"
                        style={{ maxHeight: "16rem", overflowY: "auto" }}
                      >
                        {visibleJournalOptions.map((journalOption) => (
                          <Text as="label" size="2" key={journalOption.name}>
                            <Flex align="center" justify="between" gap="2">
                              <Flex align="center" gap="2">
                                <Checkbox
                                  checked={selectedJournalFilters.includes(
                                    journalOption.name,
                                  )}
                                  onCheckedChange={() =>
                                    toggleJournalSelection(journalOption.name)
                                  }
                                />
                                <span>{journalOption.name}</span>
                              </Flex>
                              <Badge color="gray" variant="soft">
                                {journalOption.count}
                              </Badge>
                            </Flex>
                          </Text>
                        ))}
                      </Flex>
                    ) : (
                      <Text size="2" color="gray">
                        No journals found.
                      </Text>
                    )}
                  </Flex>
                </Tabs.Content>

                <Tabs.Content value="countries">
                  <Flex direction="column" gap="3" pt="3">
                    <TextField.Root
                      value={countryQuery}
                      onChange={(event) => setCountryQuery(event.target.value)}
                      placeholder="Search countries"
                      aria-label="Search countries"
                      size="2"
                    >
                      <TextField.Slot>
                        <MagnifyingGlassIcon height="16" width="16" />
                      </TextField.Slot>
                    </TextField.Root>
                    {visibleCountryOptions.length > 0 ? (
                      <Flex
                        direction="column"
                        gap="2"
                        style={{ maxHeight: "16rem", overflowY: "auto" }}
                      >
                        {visibleCountryOptions.map((countryOption) => (
                          <Text as="label" size="2" key={countryOption.code}>
                            <Flex align="center" justify="between" gap="2">
                              <Flex align="center" gap="2">
                                <Checkbox
                                  checked={selectedCountryFilters.includes(
                                    countryOption.code,
                                  )}
                                  onCheckedChange={() =>
                                    toggleCountrySelection(countryOption.code)
                                  }
                                />
                                <span>{countryOption.label}</span>
                              </Flex>
                              <Badge color="gray" variant="soft">
                                {countryOption.count}
                              </Badge>
                            </Flex>
                          </Text>
                        ))}
                      </Flex>
                    ) : (
                      <Text size="2" color="gray">
                        No countries found.
                      </Text>
                    )}
                  </Flex>
                </Tabs.Content>

                <Tabs.Content value="library-strategy">
                  <Flex direction="column" gap="3" pt="3">
                    <TextField.Root
                      value={libraryStrategyQuery}
                      onChange={(event) =>
                        setLibraryStrategyQuery(event.target.value)
                      }
                      placeholder="Search library strategies"
                      aria-label="Search library strategies"
                      size="2"
                    >
                      <TextField.Slot>
                        <MagnifyingGlassIcon height="16" width="16" />
                      </TextField.Slot>
                    </TextField.Root>
                    {visibleLibraryStrategyOptions.length > 0 ? (
                      <Flex
                        direction="column"
                        gap="2"
                        style={{ maxHeight: "16rem", overflowY: "auto" }}
                      >
                        {visibleLibraryStrategyOptions.map(
                          (libraryStrategyOption) => (
                            <Text
                              as="label"
                              size="2"
                              key={libraryStrategyOption.name}
                            >
                              <Flex align="center" justify="between" gap="2">
                                <Flex align="center" gap="2">
                                  <Checkbox
                                    checked={selectedLibraryStrategyFilters.includes(
                                      libraryStrategyOption.name,
                                    )}
                                    onCheckedChange={() =>
                                      toggleLibraryStrategySelection(
                                        libraryStrategyOption.name,
                                      )
                                    }
                                  />
                                  <span>{libraryStrategyOption.name}</span>
                                </Flex>
                                <Badge color="gray" variant="soft">
                                  {libraryStrategyOption.count}
                                </Badge>
                              </Flex>
                            </Text>
                          ),
                        )}
                      </Flex>
                    ) : (
                      <Text size="2" color="gray">
                        No library strategies found.
                      </Text>
                    )}
                  </Flex>
                </Tabs.Content>

                <Tabs.Content value="instrument-models">
                  <Flex direction="column" gap="3" pt="3">
                    <TextField.Root
                      value={instrumentModelQuery}
                      onChange={(event) =>
                        setInstrumentModelQuery(event.target.value)
                      }
                      placeholder="Search instrument models"
                      aria-label="Search instrument models"
                      size="2"
                    >
                      <TextField.Slot>
                        <MagnifyingGlassIcon height="16" width="16" />
                      </TextField.Slot>
                    </TextField.Root>
                    {visibleInstrumentModelOptions.length > 0 ? (
                      <Flex
                        direction="column"
                        gap="2"
                        style={{ maxHeight: "16rem", overflowY: "auto" }}
                      >
                        {visibleInstrumentModelOptions.map(
                          (instrumentModelOption) => (
                            <Text
                              as="label"
                              size="2"
                              key={instrumentModelOption.name}
                            >
                              <Flex align="center" justify="between" gap="2">
                                <Flex align="center" gap="2">
                                  <Checkbox
                                    checked={selectedInstrumentModelFilters.includes(
                                      instrumentModelOption.name,
                                    )}
                                    onCheckedChange={() =>
                                      toggleInstrumentModelSelection(
                                        instrumentModelOption.name,
                                      )
                                    }
                                  />
                                  <span>{instrumentModelOption.name}</span>
                                </Flex>
                                <Badge color="gray" variant="soft">
                                  {instrumentModelOption.count}
                                </Badge>
                              </Flex>
                            </Text>
                          ),
                        )}
                      </Flex>
                    ) : (
                      <Text size="2" color="gray">
                        No instrument models found.
                      </Text>
                    )}
                  </Flex>
                </Tabs.Content>

                <Tabs.Content value="platform">
                  <Flex direction="column" gap="3" pt="3">
                    <Text as="label" size="2">
                      <Flex align="center" gap="2">
                        <Checkbox
                          checked={multiPlatformOnly}
                          onCheckedChange={(checked) =>
                            setMultiPlatformOnly(checked === true)
                          }
                        />
                        <span>Multi-platform studies only</span>
                        <Tooltip content="Studies that sequenced the same samples on 2+ platforms (e.g. Illumina + Oxford Nanopore). Useful for benchmarking or hybrid assembly papers.">
                          <InfoCircledIcon
                            width="13"
                            height="13"
                            style={{ opacity: 0.6 }}
                          />
                        </Tooltip>
                      </Flex>
                    </Text>
                    <Separator size="4" />
                    <TextField.Root
                      value={platformQuery}
                      onChange={(event) =>
                        setPlatformQuery(event.target.value)
                      }
                      placeholder="Search platforms"
                      aria-label="Search platforms"
                      size="2"
                    >
                      <TextField.Slot>
                        <MagnifyingGlassIcon height="16" width="16" />
                      </TextField.Slot>
                    </TextField.Root>
                    {visiblePlatformOptions.length > 0 ? (
                      <Flex
                        direction="column"
                        gap="2"
                        style={{ maxHeight: "16rem", overflowY: "auto" }}
                      >
                        {visiblePlatformOptions.map((platformOption) => (
                          <Text
                            as="label"
                            size="2"
                            key={platformOption.name}
                          >
                            <Flex align="center" justify="between" gap="2">
                              <Flex align="center" gap="2">
                                <Checkbox
                                  checked={selectedPlatformFilters.includes(
                                    platformOption.name,
                                  )}
                                  onCheckedChange={() =>
                                    togglePlatformSelection(platformOption.name)
                                  }
                                />
                                <span>
                                  {PLATFORM_DISPLAY[platformOption.name] ??
                                    platformOption.name}
                                </span>
                              </Flex>
                              <Badge color="gray" variant="soft">
                                {platformOption.count}
                              </Badge>
                            </Flex>
                          </Text>
                        ))}
                      </Flex>
                    ) : (
                      <Text size="2" color="gray">
                        No platforms found.
                      </Text>
                    )}
                  </Flex>
                </Tabs.Content>
              </Tabs.Root>
            </Dialog.Content>
          </Dialog.Root>
        </Flex>
      ) : null}
    </>
  );
}
