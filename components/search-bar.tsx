"use client";
import GitHubButton from "@/components/github-button";
import SearchHistoryDropdown from "@/components/search-history-dropdown";
import ThemeToggle from "@/components/theme-toggle";
import { useSearchQuery } from "@/context/search_query";
import { SEARCH_PLACEHOLDER } from "@/utils/constants";
import { NAV_ITEMS, type NavItem } from "@/utils/nav";
import { useSearchHistory } from "@/utils/useSearchHistory";
import {
  GitHubLogoIcon,
  HamburgerMenuIcon,
  MagnifyingGlassIcon,
} from "@radix-ui/react-icons";
import {
  Box,
  DropdownMenu,
  Flex,
  IconButton,
  Link,
  TextField,
} from "@radix-ui/themes";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";

interface SearchBarProps {
  initialQuery?: string | null;
}

export default function SearchBar({ initialQuery }: SearchBarProps) {
  return (
    <Suspense fallback={null}>
      <SearchBarContent initialQuery={initialQuery} />
    </Suspense>
  );
}

function SearchBarContent({ initialQuery }: SearchBarProps) {
  const { lastSearchQuery, setLastSearchQuery } = useSearchQuery();
  const resolvedQuery = (initialQuery ?? "") || lastSearchQuery;
  const [searchQuery, setSearchQuery] = useState(resolvedQuery);
  const [suggestionFilterQuery, setSuggestionFilterQuery] =
    useState(resolvedQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset local edits when the resolved query prop changes (adjust during render).
  const [prevResolvedQuery, setPrevResolvedQuery] = useState(resolvedQuery);
  if (resolvedQuery !== prevResolvedQuery) {
    setPrevResolvedQuery(resolvedQuery);
    setSearchQuery(resolvedQuery);
    setSuggestionFilterQuery(resolvedQuery);
  }
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const { history, saveHistory, performSearch } = useSearchHistory();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentDb = searchParams.get("db");

  const handleMenuSelect = (item: NavItem) => {
    if (item.external) {
      window.open(item.href, "_blank", "noopener,noreferrer");
      return;
    }

    router.push(item.href);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (trimmed) setLastSearchQuery(trimmed);
    await performSearch(searchQuery, router.push, currentDb);
  };

  const handleHistoryClick = async (item: string) => {
    setSearchQuery(item);
    setIsFocused(false);
    const trimmed = item.trim();
    if (trimmed) setLastSearchQuery(trimmed);
    await performSearch(item, router.push, currentDb);
  };

  const removeItem = (item: string, e: React.MouseEvent) => {
    e.stopPropagation();
    saveHistory(history.filter((h: string) => h !== item));
  };

  // Filter history based on query - only show if query has text
  const trimmedQuery = suggestionFilterQuery.trim();
  const filteredHistory = trimmedQuery
    ? history
        .filter((h: string) => {
          const hLower = h.toLowerCase();
          const qLower = trimmedQuery.toLowerCase();
          // include if it contains the query but is not an exact match
          return hLower.includes(qLower) && hLower !== qLower;
        })
        .slice(0, 5)
    : [];

  // Reset keyboard selection whenever focus or the visible suggestions change.
  const resetKey = `${isFocused}|${filteredHistory.length}|${trimmedQuery}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setActiveIndex(-1);
  }

  return (
    <Flex
      justify={{ initial: "center", md: "between" }}
      align={{ initial: "start", md: "center" }}
      p={{ initial: "0", md: "3" }}
      pb={"3"}
      gap={"4"}
      style={{
        position: "sticky",
        top: 0,
        width: "100%",
        zIndex: 1100,
        backgroundColor: "var(--color-background)",
        borderBottom: "1px solid var(--gray-a4)",
      }}
    >
      <Box
        display={{ initial: "block", md: "none" }}
        style={{ position: "absolute", top: "0.5rem", left: "0.5rem" }}
      >
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton
              variant="ghost"
              size="3"
              aria-label="Open navigation menu"
            >
              <HamburgerMenuIcon width={20} height={20} />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" style={{ minWidth: "8rem" }}>
            {NAV_ITEMS.map((item) => (
              <DropdownMenu.Item
                key={item.label}
                onSelect={() => handleMenuSelect(item)}
              >
                {item.icon} {item.label}
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              onSelect={() =>
                window.open(
                  "https://github.com/saketlab/seqout",
                  "_blank",
                  "noopener,noreferrer",
                )
              }
            >
              <GitHubLogoIcon /> GitHub
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Box>
      <Flex
        gap={"4"}
        align={"center"}
        flexGrow={"1"}
        direction={{ initial: "column", md: "row" }}
        pt={"2"}
      >
        <Link href="/" style={{ textDecoration: "none" }}>
          <Box
            width="10rem"
            style={{
              position: "relative",
              aspectRatio: "794/186",
            }}
          >
            <Image
              className="logo-light"
              src="/short-logo-light.svg"
              alt="seqout"
              fill
              loading="eager"
              sizes="10rem"
              style={{ objectFit: "contain" }}
            />
            <Image
              className="logo-dark"
              src="/short-logo-dark.svg"
              alt="seqout"
              fill
              loading="eager"
              sizes="10rem"
              style={{ objectFit: "contain" }}
            />
          </Box>
        </Link>

        <Box
          width={{ initial: "98%", md: "70%" }}
          style={{ position: "relative" }}
        >
          <form onSubmit={handleSubmit}>
            <TextField.Root
              size={"3"}
              data-global-search-target="true"
              placeholder={SEARCH_PLACEHOLDER}
              ref={inputRef}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSuggestionFilterQuery(e.target.value);
                setActiveIndex(-1);
              }}
              onFocus={() => {
                setIsFocused(true);
                setSuggestionFilterQuery(searchQuery);
                setActiveIndex(-1);
              }}
              onBlur={() => setIsFocused(false)}
              onKeyDown={(e) => {
                if (!isFocused || filteredHistory.length === 0) return;

                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIndex((prev) => {
                    const nextIndex =
                      prev === -1 ? 0 : (prev + 1) % filteredHistory.length;
                    const nextItem = filteredHistory[nextIndex];
                    setSearchQuery(nextItem);
                    requestAnimationFrame(() => {
                      const input = inputRef.current;
                      if (!input) return;
                      const pos = nextItem.length;
                      input.setSelectionRange(pos, pos);
                    });
                    return nextIndex;
                  });
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIndex((prev) => {
                    const nextIndex =
                      prev === -1
                        ? filteredHistory.length - 1
                        : (prev - 1 + filteredHistory.length) %
                          filteredHistory.length;
                    const nextItem = filteredHistory[nextIndex];
                    setSearchQuery(nextItem);
                    requestAnimationFrame(() => {
                      const input = inputRef.current;
                      if (!input) return;
                      const pos = nextItem.length;
                      input.setSelectionRange(pos, pos);
                    });
                    return nextIndex;
                  });
                } else if (e.key === "Enter") {
                  if (activeIndex >= 0) {
                    e.preventDefault();
                    const item = filteredHistory[activeIndex];
                    void handleHistoryClick(item);
                  }
                } else if (e.key === "Escape") {
                  setIsFocused(false);
                  setActiveIndex(-1);
                }
              }}
              value={searchQuery}
              style={{ fontFamily: "var(--default-font-family)" }}
            >
              <TextField.Slot>
                <MagnifyingGlassIcon height="16" width="16" />
              </TextField.Slot>
            </TextField.Root>
          </form>

          <SearchHistoryDropdown
            isVisible={isFocused}
            filteredHistory={filteredHistory}
            onHistoryClick={handleHistoryClick}
            onRemoveItem={removeItem}
            activeItem={activeIndex >= 0 ? filteredHistory[activeIndex] : null}
            position="absolute"
          />
        </Box>
      </Flex>
      <Flex
        gap={"3"}
        align={"center"}
        display={{ initial: "none", md: "flex" }}
      >
        <GitHubButton />
        <ThemeToggle />
      </Flex>
      <Box
        display={{ initial: "block", md: "none" }}
        style={{ position: "absolute", top: "0.5rem", right: "0.5rem" }}
      >
        <ThemeToggle />
      </Box>
    </Flex>
  );
}
