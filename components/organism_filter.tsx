"use client";

import { SERVER_URL } from "@/utils/constants";
import {
  Badge,
  Button,
  Flex,
  Separator,
  Switch,
  Text,
} from "@radix-ui/themes";
import * as React from "react";

type ScientificFacet = { name: string; count: number };

type OrganismDisplayFacet = {
  key: string;
  label: string;
  count: number;
};

export type OrganismNameMode = "scientific" | "common";

function capitalizeFirstLetter(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildScientificFacets(
  results: Array<{ organisms: string[] | null }>,
): ScientificFacet[] {
  const counts = new Map<string, number>();

  for (const r of results) {
    const orgs = r.organisms ?? [];
    for (const org of orgs) {
      const key = org.trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function parseCommonName(payload: unknown): string | null {
  if (typeof payload === "string") {
    const value = payload.trim();
    return value.length > 0 ? value : null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const parsed = parseCommonName(item);
      if (parsed) return parsed;
    }
    return null;
  }

  if (payload && typeof payload === "object") {
    const asRecord = payload as Record<string, unknown>;
    const candidates = [
      asRecord.common_name,
      asRecord.commonName,
      asRecord.name,
      asRecord.common,
      asRecord.value,
      asRecord.result,
      asRecord.data,
    ];

    for (const candidate of candidates) {
      const parsed = parseCommonName(candidate);
      if (parsed) return parsed;
    }
  }

  return null;
}

const commonNameCache = new Map<string, string | null>();
const commonNameRequests = new Map<string, Promise<string | null>>();

function getCachedCommonNames(scientificNames: string[]): Map<string, string> {
  const commonNames = new Map<string, string>();

  for (const scientificName of scientificNames) {
    const commonName = commonNameCache.get(scientificName);
    if (commonName) {
      commonNames.set(scientificName, commonName);
    }
  }

  return commonNames;
}

async function fetchCommonName(
  scientificName: string,
): Promise<string | null> {
  if (commonNameCache.has(scientificName)) {
    return commonNameCache.get(scientificName) ?? null;
  }

  const existingRequest = commonNameRequests.get(scientificName);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    try {
      const url = `${SERVER_URL}/common-name?scientific_name=${encodeURIComponent(
        scientificName,
      )}`;
      const res = await fetch(url);
      if (!res.ok) return null;

      const raw = (await res.text()).trim();
      if (!raw) return null;

      let payload: unknown = raw;
      try {
        payload = JSON.parse(raw);
      } catch {}

      return (
        parseCommonName(payload) ??
        (payload !== raw ? parseCommonName(raw) : null)
      );
    } catch {
      return null;
    }
  })()
    .then((commonName) => {
      commonNameCache.set(scientificName, commonName);
      return commonName;
    })
    .finally(() => {
      commonNameRequests.delete(scientificName);
    });

  commonNameRequests.set(scientificName, request);
  return request;
}

function buildCommonFacets(
  scientificFacets: ScientificFacet[],
  commonNamesByScientific: Map<string, string>,
): OrganismDisplayFacet[] {
  return scientificFacets
    .map((facet) => ({
      key: facet.name,
      label:
        capitalizeFirstLetter(
          (commonNamesByScientific.get(facet.name) ?? facet.name).trim(),
        ) || facet.name,
      count: facet.count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildDisplayFacets(
  scientificFacets: ScientificFacet[],
  mode: OrganismNameMode,
  commonNamesByScientific: Map<string, string>,
): OrganismDisplayFacet[] {
  if (mode === "scientific") {
    return scientificFacets.map((facet) => ({
      key: facet.name,
      label: facet.name,
      count: facet.count,
    }));
  }

  return buildCommonFacets(scientificFacets, commonNamesByScientific);
}

function FilterList({
  facets,
  selectedKey,
  totalCount,
  onSelect,
  onClear,
}: {
  facets: OrganismDisplayFacet[];
  selectedKey: string | null;
  totalCount: number;
  onSelect: (facetKey: string) => void;
  onClear: () => void;
}) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const hasMoreThanTop = facets.length > 5;
  const visibleFacets = isExpanded ? facets : facets.slice(0, 5);

  return (
    <Flex direction="column" gap="2">
      <Button
        variant={selectedKey === null ? "solid" : "soft"}
        color={selectedKey === null ? undefined : "gray"}
        onClick={onClear}
        style={{ justifyContent: "space-between" }}
      >
        <span>All organisms</span>
        <Badge variant={selectedKey === null ? "solid" : "soft"}>
          {totalCount}
        </Badge>
      </Button>

      <div
        className={isExpanded ? "organism-list-scroll" : undefined}
        style={{
          maxHeight: isExpanded ? 360 : undefined,
          overflowY: isExpanded ? "scroll" : "visible",
          paddingRight: isExpanded ? 4 : undefined,
        }}
      >
        <Flex direction="column" gap="2">
          {visibleFacets.map((facet) => {
            const active = selectedKey === facet.key;
            return (
              <Button
                key={facet.key}
                variant={active ? "solid" : "soft"}
                color={active ? undefined : "gray"}
                onClick={() => onSelect(facet.key)}
                style={{ justifyContent: "space-between", textAlign: "left" }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {facet.label}
                </span>
                <Badge variant={active ? "solid" : "soft"}>{facet.count}</Badge>
              </Button>
            );
          })}

          {facets.length === 0 ? (
            <Text size="2" color="gray">
              No organism data available for these results.
            </Text>
          ) : null}
        </Flex>
      </div>

      {hasMoreThanTop ? (
        <Button
          size="1"
          variant="soft"
          color="gray"
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          {isExpanded ? "Show less" : `Show ${facets.length - 5} more`}
        </Button>
      ) : null}
      <style jsx>{`
        .organism-list-scroll {
          scrollbar-width: thin;
          scrollbar-color: var(--gray-a6) transparent;
        }
        .organism-list-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .organism-list-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .organism-list-scroll::-webkit-scrollbar-thumb {
          background-color: var(--gray-a6);
          border-radius: 3px;
        }
        .organism-list-scroll::-webkit-scrollbar-thumb:hover {
          background-color: var(--gray-a8);
        }
      `}</style>
    </Flex>
  );
}

export function OrganismFilter({
  results,
  mode,
  onChangeMode,
  selectedKey,
  onChangeSelection,
}: {
  results: Array<{ organisms: string[] | null }>;
  mode: OrganismNameMode;
  onChangeMode: (mode: OrganismNameMode) => void;
  selectedKey: string | null;
  onChangeSelection: (next: string | null) => void;
}) {
  const scientificFacets = React.useMemo(
    () => buildScientificFacets(results),
    [results],
  );
  const scientificNames = React.useMemo(
    () => scientificFacets.map((facet) => facet.name),
    [scientificFacets],
  );
  const [, refreshCommonNames] = React.useReducer(
    (version: number) => version + 1,
    0,
  );
  const commonNamesByScientific = getCachedCommonNames(scientificNames);

  React.useEffect(() => {
    if (mode !== "common" || scientificNames.length === 0) return;

    const missing = scientificNames.filter(
      (name) => !commonNameCache.has(name),
    );
    if (missing.length === 0) return;

    let cancelled = false;

    const fetchMissing = async () => {
      await Promise.all(missing.map(fetchCommonName));

      if (!cancelled) {
        refreshCommonNames();
      }
    };

    fetchMissing();

    return () => {
      cancelled = true;
    };
  }, [mode, scientificNames]);

  const facets = React.useMemo(
    () => buildDisplayFacets(scientificFacets, mode, commonNamesByScientific),
    [scientificFacets, mode, commonNamesByScientific],
  );

  const totalCount = results.length;

  const onClear = () => onChangeSelection(null);
  const onSelect = (facetKey: string) => onChangeSelection(facetKey);

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" justify="between">
        <Text size="2">Display scientific names</Text>
        <Switch
          checked={mode === "scientific"}
          onCheckedChange={(checked) =>
            onChangeMode(checked ? "scientific" : "common")
          }
        />
      </Flex>
      <Separator size="4" />
      <FilterList
        facets={facets}
        selectedKey={selectedKey}
        totalCount={totalCount}
        onSelect={onSelect}
        onClear={onClear}
      />
    </Flex>
  );
}
