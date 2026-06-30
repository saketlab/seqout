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

export type ScientificFacet = { name: string; count: number };

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

const commonNameCache = new Map<string, string | null>();

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

// Resolve every missing scientific name in a single /common-names request.
// Rows come back keyed by scientific_name (case-insensitive); anything the
// server omits is cached as null so we don't re-ask for it.
async function fetchCommonNames(scientificNames: string[]): Promise<void> {
  const missing = scientificNames.filter((n) => !commonNameCache.has(n));
  if (missing.length === 0) return;

  const byLowerName = new Map<string, string>();
  try {
    const params = missing
      .map((n) => `scientific_name=${encodeURIComponent(n)}`)
      .join("&");
    const res = await fetch(`${SERVER_URL}/common-names?${params}`);
    if (res.ok) {
      const rows: unknown = await res.json();
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const sci = (row as { scientific_name?: unknown })?.scientific_name;
          const common = (row as { common_name?: unknown })?.common_name;
          if (typeof sci === "string" && typeof common === "string") {
            const key = sci.trim().toLowerCase();
            // ORDER BY common_name → keep the first per name.
            if (key && common.trim() && !byLowerName.has(key)) {
              byLowerName.set(key, common.trim());
            }
          }
        }
      }
    }
  } catch {}

  for (const name of missing) {
    commonNameCache.set(name, byLowerName.get(name.trim().toLowerCase()) ?? null);
  }
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
  serverFacets,
  totalCount: totalCountProp,
  mode,
  onChangeMode,
  selectedKey,
  onChangeSelection,
}: {
  results: Array<{ organisms: string[] | null }>;
  // Exact organism counts from /search/facets. When present, they override the
  // client-derived counts (which only reflect loaded pages); the client base
  // still fills the long tail beyond the server's capped top-N.
  serverFacets?: ScientificFacet[];
  // Exact total study count for the "All organisms" row. Without it the count
  // would reflect only the loaded pages (server pagination loads them lazily).
  totalCount?: number;
  mode: OrganismNameMode;
  onChangeMode: (mode: OrganismNameMode) => void;
  selectedKey: string | null;
  onChangeSelection: (next: string | null) => void;
}) {
  const scientificFacets = React.useMemo(() => {
    const base = buildScientificFacets(results);
    if (!serverFacets || serverFacets.length === 0) return base;
    const counts = new Map(base.map((f) => [f.name, f.count]));
    for (const f of serverFacets) counts.set(f.name, f.count);
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [results, serverFacets]);
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

    fetchCommonNames(scientificNames).then(() => {
      if (!cancelled) refreshCommonNames();
    });

    return () => {
      cancelled = true;
    };
  }, [mode, scientificNames]);

  const facets = React.useMemo(
    () => buildDisplayFacets(scientificFacets, mode, commonNamesByScientific),
    [scientificFacets, mode, commonNamesByScientific],
  );

  const totalCount = totalCountProp ?? results.length;

  const onClear = () => onChangeSelection(null);
  const onSelect = (facetKey: string) => onChangeSelection(facetKey);

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" justify="between">
        <Text size="2">Show common names</Text>
        <Switch
          checked={mode === "common"}
          onCheckedChange={(checked) =>
            onChangeMode(checked ? "common" : "scientific")
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
