"use client";

import {
  Badge,
  Button,
  Flex,
  Separator,
  Text,
  TextField,
} from "@radix-ui/themes";
import * as React from "react";

export type InstituteFacet = { name: string; count: number };

// Right-side affiliation facet for the author page. Mirrors the organism
// filter's FilterList: "All institutes" clear row, count badges, show-more,
// and a search box once the list is long. Selection is single-choice and
// filtering happens client-side (all results are already loaded).
export function InstituteFilter({
  facets,
  totalCount,
  selectedKey,
  onChangeSelection,
}: {
  facets: InstituteFacet[];
  totalCount: number;
  selectedKey: string | null;
  onChangeSelection: (next: string | null) => void;
}) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const normalized = query.trim().toLowerCase();
  const showSearch = facets.length > 5;

  const searched = React.useMemo(
    () =>
      normalized
        ? facets.filter((f) => f.name.toLowerCase().includes(normalized))
        : facets,
    [facets, normalized],
  );

  const isSearchActive = normalized.length > 0;
  const hasMoreThanTop = !isSearchActive && searched.length > 5;
  const visible =
    isSearchActive || isExpanded ? searched : searched.slice(0, 5);
  const shouldScroll = isExpanded || (isSearchActive && searched.length > 5);

  return (
    <Flex direction="column" gap="3">
      <Text size="2" weight="medium">
        Institutes
      </Text>
      <Separator size="4" />
      {showSearch ? (
        <TextField.Root
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search institutes"
          aria-label="Search institutes"
          size="2"
          variant="surface"
        />
      ) : null}

      <Flex direction="column" gap="2">
        <Button
          variant={selectedKey === null ? "solid" : "soft"}
          color={selectedKey === null ? undefined : "gray"}
          onClick={() => onChangeSelection(null)}
          style={{ justifyContent: "space-between" }}
        >
          <span>All institutes</span>
          <Badge variant={selectedKey === null ? "solid" : "soft"}>
            {totalCount}
          </Badge>
        </Button>

        <div
          className={shouldScroll ? "institute-list-scroll" : undefined}
          style={{
            maxHeight: shouldScroll ? 360 : undefined,
            overflowY: shouldScroll ? "scroll" : "visible",
            paddingRight: shouldScroll ? 4 : undefined,
          }}
        >
          <Flex direction="column" gap="2">
            {visible.map((facet) => {
              const active = selectedKey === facet.name;
              return (
                <Button
                  key={facet.name}
                  variant={active ? "solid" : "soft"}
                  color={active ? undefined : "gray"}
                  onClick={() => onChangeSelection(facet.name)}
                  style={{ justifyContent: "space-between", textAlign: "left" }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {facet.name}
                  </span>
                  <Badge
                    variant={active ? "solid" : "soft"}
                    style={{ flexShrink: 0 }}
                  >
                    {facet.count}
                  </Badge>
                </Button>
              );
            })}

            {searched.length === 0 ? (
              <Text size="2" color="gray">
                {isSearchActive
                  ? "No institutes match your search."
                  : "No institute data available for these results."}
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
            {isExpanded ? "Show less" : `Show ${searched.length - 5} more`}
          </Button>
        ) : null}
      </Flex>
      <style jsx>{`
        .institute-list-scroll {
          scrollbar-width: thin;
          scrollbar-color: var(--gray-a6) transparent;
        }
        .institute-list-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .institute-list-scroll::-webkit-scrollbar-thumb {
          background-color: var(--gray-a6);
          border-radius: 3px;
        }
      `}</style>
    </Flex>
  );
}
