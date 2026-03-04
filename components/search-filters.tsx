"use client";

import { OrganismFilter, OrganismNameMode } from "@/components/organism_filter";
import type { SortBy } from "@/components/search-page-body";
import { SearchResult } from "@/utils/types";
import {
  MagnifyingGlassIcon,
  MixerHorizontalIcon,
} from "@radix-ui/react-icons";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Flex,
  RadioGroup,
  Select,
  Separator,
  Tabs,
  Text,
  TextField,
} from "@radix-ui/themes";
import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { useState } from "react";

countries.registerLocale(enLocale);

type TimeFilter = "any" | "1" | "5" | "10" | "20" | "custom";

type SearchFiltersProps = {
  db: string | null;
  query: string | null;
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
  setSortBy,
  setTimeFilter,
  timeFilter,
  customYearRange,
  setCustomYearRange,
  onDatabaseChange,
}: SearchFiltersProps) {
  return (
    <>
      <Flex
        direction={"row"}
        gap={"2"}
        wrap="wrap"
        display={{ initial: "flex", md: "none" }}
      >
        <Select.Root
          defaultValue="relevance"
          name="sort"
          onValueChange={(value) => setSortBy(value as SortBy)}
          size={"1"}
        >
          <Select.Trigger />
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
          defaultValue="any"
          name="time"
          onValueChange={(value) =>
            setTimeFilter(value as "any" | "1" | "5" | "10" | "20")
          }
          size={"1"}
        >
          <Select.Trigger />
          <Select.Content>
            <Select.Group>
              <Select.Item value="any">Any time</Select.Item>
              <Select.Item value="1">Last year</Select.Item>
              <Select.Item value="5">5 yrs</Select.Item>
              <Select.Item value="10">10 yrs</Select.Item>
              <Select.Item value="20">20 yrs</Select.Item>
            </Select.Group>
          </Select.Content>
        </Select.Root>

        <Select.Root
          defaultValue={db ? db : "both"}
          onValueChange={(value) => {
            if (!query) return;
            onDatabaseChange(value as "geo" | "sra" | "arrayexpress" | "both");
          }}
          size={"1"}
        >
          <Select.Trigger />
          <Select.Content>
            <Select.Group>
              <Select.Item value="geo">GEO</Select.Item>
              <Select.Item value="sra">SRA</Select.Item>
              <Select.Item value="arrayexpress">ArrayExpress</Select.Item>
              <Select.Item value="both">From all sources</Select.Item>
            </Select.Group>
          </Select.Content>
        </Select.Root>
      </Flex>

      <Flex
        direction={"column"}
        gap={"4"}
        display={{ initial: "none", md: "flex" }}
        position={"sticky"}
        style={{ top: "9rem" }}
        height={"fit-content"}
      >
        <RadioGroup.Root
          defaultValue={db ? db : "both"}
          name="dataset"
          onValueChange={(value) => {
            if (!query) return;
            onDatabaseChange(value as "geo" | "sra" | "arrayexpress" | "both");
          }}
        >
          <RadioGroup.Item value="geo">Only GEO</RadioGroup.Item>
          <RadioGroup.Item value="sra">Only SRA</RadioGroup.Item>
          <RadioGroup.Item value="arrayexpress">
            Only ArrayExpress
          </RadioGroup.Item>
          <RadioGroup.Item value="both">From all sources</RadioGroup.Item>
        </RadioGroup.Root>

        <Separator orientation={"horizontal"} size={"4"} />

        <RadioGroup.Root
          defaultValue="relevance"
          name="sort"
          onValueChange={(value) => setSortBy(value as SortBy)}
        >
          <RadioGroup.Item value="relevance">Sort by relevance</RadioGroup.Item>
          <RadioGroup.Item value="date">Sort by date</RadioGroup.Item>
          <RadioGroup.Item value="citations">Sort by citations</RadioGroup.Item>
          <RadioGroup.Item value="journal">Sort by journal</RadioGroup.Item>
        </RadioGroup.Root>

        <Separator orientation={"horizontal"} size={"4"} />

        <RadioGroup.Root
          defaultValue="any"
          name="time"
          onValueChange={(value) =>
            setTimeFilter(value as "any" | "1" | "5" | "10" | "20" | "custom")
          }
        >
          <RadioGroup.Item value="any">Any time</RadioGroup.Item>
          <RadioGroup.Item value="1">Since last year</RadioGroup.Item>
          <RadioGroup.Item value="5">Since last 5 years</RadioGroup.Item>
          <RadioGroup.Item value="10">Since last 10 years</RadioGroup.Item>
          <RadioGroup.Item value="20">Since last 20 years</RadioGroup.Item>
          <RadioGroup.Item value="custom">Custom range</RadioGroup.Item>
        </RadioGroup.Root>
        {timeFilter === "custom" && (
          <Flex gap="2" align="center">
            <TextField.Root
              type="number"
              min="2000"
              max={new Date().getFullYear()}
              value={customYearRange.from}
              onChange={(e) =>
                setCustomYearRange({ ...customYearRange, from: e.target.value })
              }
              placeholder="YYYY"
              variant="surface"
              size={"2"}
              style={{ width: "3.5rem" }}
            />
            <Text size="2">to</Text>
            <TextField.Root
              type="number"
              min="2000"
              max={new Date().getFullYear()}
              value={customYearRange.to}
              onChange={(e) =>
                setCustomYearRange({ ...customYearRange, to: e.target.value })
              }
              placeholder="YYYY"
              variant="surface"
              style={{ width: "3.5rem" }}
              size={"2"}
            />
          </Flex>
        )}
      </Flex>
    </>
  );
}

export function SearchOrganismRail({
  results,
  journalResults,
  countryResults,
  libraryStrategyResults,
  instrumentModelResults,
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
  showMobile = false,
  showDesktop = true,
}: {
  results: SearchResult[];
  journalResults: SearchResult[];
  countryResults: SearchResult[];
  libraryStrategyResults: SearchResult[];
  instrumentModelResults: SearchResult[];
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
      setSelectedJournalFilters([]);
      return;
    }
    setSelectedJournalFilters([journal]);
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
      setSelectedCountryFilters([]);
      return;
    }
    setSelectedCountryFilters([countryCode]);
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
      setSelectedLibraryStrategyFilters([]);
      return;
    }
    setSelectedLibraryStrategyFilters([strategy]);
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
      setSelectedInstrumentModelFilters([]);
      return;
    }
    setSelectedInstrumentModelFilters([model]);
  };

  const selectedFilterCount =
    selectedJournalFilters.length +
    selectedCountryFilters.length +
    selectedLibraryStrategyFilters.length +
    selectedInstrumentModelFilters.length;

  return (
    <>
      {showMobile ? (
        <Flex display={{ initial: "flex", md: "none" }} gap="2" wrap="wrap">
          <Dialog.Root open={organismsOpen} onOpenChange={setOrganismsOpen}>
            <Dialog.Trigger>
              <Button variant="surface" size="1">
                Organisms
                {selectedOrganismKey ? <Badge color="blue">1</Badge> : null}
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
              <Button variant="surface" size="1">
                <MixerHorizontalIcon />
                More filters
                {selectedFilterCount > 0 ? (
                  <Badge color="blue">{selectedFilterCount}</Badge>
                ) : null}
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
                <Flex align={"center"} gap={"2"}>
                  <Text>More filters</Text>
                  <Badge color="teal">Beta</Badge>
                </Flex>
              </Dialog.Title>
              <Dialog.Description size={"1"}>
                Filters apply only to loaded results. Scroll to load more.
                Selecting a filter also has the effect of fetching more results.
              </Dialog.Description>

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
                </Tabs.List>

                <Tabs.Content value="journals">
                  <Flex direction="column" gap="3" pt="3">
                    <TextField.Root
                      value={journalQuery}
                      onChange={(event) => setJournalQuery(event.target.value)}
                      placeholder="Search journals"
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
          style={{ top: "7rem", height: "fit-content" }}
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
                <Flex align={"center"} gap={"2"}>
                  <Text>More filters</Text>
                  <Badge color="teal">Beta</Badge>
                </Flex>
              </Dialog.Title>
              <Dialog.Description size={"1"}>
                Filters apply only to loaded results. Scroll to load more.
                Selecting a filter also has the effect of fetching more results.
              </Dialog.Description>

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
                </Tabs.List>

                <Tabs.Content value="journals">
                  <Flex direction="column" gap="3" pt="3">
                    <TextField.Root
                      value={journalQuery}
                      onChange={(event) => setJournalQuery(event.target.value)}
                      placeholder="Search journals"
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
              </Tabs.Root>
            </Dialog.Content>
          </Dialog.Root>
        </Flex>
      ) : null}
    </>
  );
}
