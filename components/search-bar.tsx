"use client";
import GitHubButton from "@/components/github-button";
import SearchHistoryDropdown from "@/components/search-history-dropdown";
import ThemeToggle from "@/components/theme-toggle";
import { useSearchQuery } from "@/context/search_query";
import { useSearchHistory } from "@/utils/useSearchHistory";
import { HamburgerMenuIcon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import {
  Box,
  DropdownMenu,
  Flex,
  IconButton,
  Link,
  TextField,
} from "@radix-ui/themes";
import { useTheme } from "next-themes";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

interface SearchBarProps {
  initialQuery?: string | null;
}

const NAV_ITEMS = [
  {
    label: "CLI",
    href: "https://saket-choudhary.me/pysradb/index.html",
    external: true,
  },
  { label: "MCP", href: "/mcp" },
  { label: "Map", href: "/map" },
  { label: "Saket Lab", href: "https://saketlab.in/", external: true },
  { label: "Contact", href: "mailto:saketc@iitb.ac.in", mailto: true },
  { label: "About", href: "/faq" },
];

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
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    setSearchQuery(resolvedQuery);
  }, [resolvedQuery]);
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const { history, saveHistory, performSearch } = useSearchHistory();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentDb = searchParams.get("db");

  const handleMenuSelect = (item: (typeof NAV_ITEMS)[number]) => {
    if (item.mailto) {
      window.location.assign(item.href);
      return;
    }

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
  const trimmedQuery = searchQuery.trim();
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

  useEffect(() => {
    if (!isFocused) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex(-1);
  }, [isFocused, filteredHistory.length, trimmedQuery]);

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
        boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
        backgroundColor: "inherit",
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
          <DropdownMenu.Content align="start">
            {NAV_ITEMS.map((item) => (
              <DropdownMenu.Item
                key={item.label}
                onSelect={() => handleMenuSelect(item)}
              >
                {item.label}
              </DropdownMenu.Item>
            ))}
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
            width={{ initial: "10rem", md: "11rem" }}
            style={{ position: "relative", aspectRatio: "619/103" }}
          >
            <Image
              src={
                resolvedTheme === "light" ? "/logo-light.svg" : "/logo-dark.svg"
              }
              alt="seqout"
              fill
              style={{ objectFit: "contain" }}
            />
          </Box>
        </Link>

        <Box
          width={{ initial: "90%", md: "70%" }}
          style={{ position: "relative" }}
        >
          <form onSubmit={handleSubmit}>
            <TextField.Root
              size={"3"}
              data-global-search-target="true"
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={(e) => {
                if (!isFocused || filteredHistory.length === 0) return;

                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIndex((prev) => {
                    if (prev === -1) return 0;
                    return (prev + 1) % filteredHistory.length;
                  });
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIndex((prev) => {
                    if (prev === -1) return filteredHistory.length - 1;
                    return (
                      (prev - 1 + filteredHistory.length) %
                      filteredHistory.length
                    );
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
        <ThemeToggle />
        <GitHubButton />
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
