"use client";

import { useToast } from "@/components/toast-provider";
import { NAV_ITEMS, type NavItem } from "@/utils/nav";
import { useSearchHistory } from "@/utils/useSearchHistory";
import {
  ClockIcon,
  HomeIcon,
  Link2Icon,
  MagnifyingGlassIcon,
  MoonIcon,
  SunIcon,
} from "@radix-ui/react-icons";
import { Dialog, Flex, Kbd, Text } from "@radix-ui/themes";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type CommandKind = "navigation" | "history" | "action" | "search";

type Command = {
  id: string;
  kind: CommandKind;
  label: string;
  hint?: string;
  icon: ReactNode;
  perform: () => void | Promise<void>;
};

export default function CommandPalette() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { showToast } = useToast();
  const { history, performSearch } = useSearchHistory();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset inline on open so we avoid a setState-in-effect.
  const openPalette = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }, []);
  const closePalette = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k") return;
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      if (open) {
        closePalette();
      } else {
        openPalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, openPalette, closePalette]);

  // RAF defer to win the race against Radix Dialog's focus trap.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const looksLikeAccession = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed || /\s/.test(trimmed)) return false;
    return /^(GSE|GSM|GPL|GDS|SRP|SRX|SRS|SRR|ERP|ERX|ERS|ERR|DRP|DRX|DRS|DRR|PRJNA|PRJEB|PRJDA|E-)\w+$/i.test(
      trimmed,
    );
  }, [query]);

  const navigate = useCallback(
    (href: string, item?: NavItem) => {
      setOpen(false);
      if (item?.external) {
        window.open(href, "_blank", "noopener,noreferrer");
      } else {
        router.push(href);
      }
    },
    [router],
  );

  const runSearch = useCallback(
    async (text: string) => {
      setOpen(false);
      await performSearch(text, (url) => router.push(url), null);
    },
    [performSearch, router],
  );

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];

    const trimmedQuery = query.trim();
    if (looksLikeAccession) {
      cmds.push({
        id: `open-accession-${trimmedQuery}`,
        kind: "search",
        label: `Open ${trimmedQuery.toUpperCase()}`,
        hint: "Direct accession lookup",
        icon: <MagnifyingGlassIcon />,
        perform: () => runSearch(trimmedQuery),
      });
    }

    if (trimmedQuery && !looksLikeAccession) {
      cmds.push({
        id: `search-${trimmedQuery}`,
        kind: "search",
        label: `Search for "${trimmedQuery}"`,
        hint: "Full-text search",
        icon: <MagnifyingGlassIcon />,
        perform: () => runSearch(trimmedQuery),
      });
    }

    if (!trimmedQuery) {
      for (const item of history.slice(0, 5)) {
        cmds.push({
          id: `history-${item}`,
          kind: "history",
          label: item,
          hint: "Recent search",
          icon: <ClockIcon />,
          perform: () => runSearch(item),
        });
      }
    }

    cmds.push({
      id: "nav-home",
      kind: "navigation",
      label: "Home",
      hint: "/",
      icon: <HomeIcon />,
      perform: () => navigate("/"),
    });
    for (const item of NAV_ITEMS) {
      cmds.push({
        id: `nav-${item.label}`,
        kind: "navigation",
        label: item.label,
        hint: item.external ? "External" : item.href,
        icon: item.icon,
        perform: () => navigate(item.href, item),
      });
    }

    cmds.push({
      id: "action-toggle-theme",
      kind: "action",
      label:
        resolvedTheme === "dark"
          ? "Switch to light theme"
          : "Switch to dark theme",
      hint: "Toggle appearance",
      icon: resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />,
      perform: () => {
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
        setOpen(false);
      },
    });
    cmds.push({
      id: "action-copy-url",
      kind: "action",
      label: "Copy current URL",
      hint: "Share this page",
      icon: <Link2Icon />,
      perform: async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          showToast("URL copied to clipboard");
        } catch {
          /* fail silently */
        }
        setOpen(false);
      },
    });

    return cmds;
  }, [
    history,
    looksLikeAccession,
    navigate,
    query,
    resolvedTheme,
    runSearch,
    setTheme,
    showToast,
  ]);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return commands;
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(trimmed) || cmd.kind === "search",
    );
  }, [commands, query]);

  // Derive (don't set in effect) so the React Compiler stays happy when
  // the filtered list shrinks under us.
  const safeActiveIndex =
    filtered.length === 0 ? 0 : Math.min(activeIndex, filtered.length - 1);

  const onListKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (filtered.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((prev) => {
          const safe = Math.min(prev, filtered.length - 1);
          return (safe + 1) % filtered.length;
        });
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((prev) => {
          const safe = Math.min(prev, filtered.length - 1);
          return safe === 0 ? filtered.length - 1 : safe - 1;
        });
      } else if (event.key === "Enter") {
        event.preventDefault();
        const cmd = filtered[safeActiveIndex];
        if (cmd) void cmd.perform();
      }
    },
    [filtered, safeActiveIndex],
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Content
        size="2"
        style={{
          width: "min(92vw, 38rem)",
          maxWidth: "min(92vw, 38rem)",
          padding: 0,
          overflow: "hidden",
        }}
      >
        <Dialog.Title style={{ display: "none" }}>Command palette</Dialog.Title>
        <Dialog.Description style={{ display: "none" }}>
          Quickly navigate, search, and run actions.
        </Dialog.Description>
        <Flex direction="column">
          {/* Search input */}
          <Flex
            align="center"
            gap="2"
            px="4"
            py="3"
            style={{ borderBottom: "1px solid var(--gray-a4)" }}
          >
            <MagnifyingGlassIcon
              width="16"
              height="16"
              style={{ color: "var(--gray-11)", flexShrink: 0 }}
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onListKeyDown}
              placeholder="Search for an accession, jump to a page, or run an action…"
              aria-label="Command palette search"
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--gray-12)",
                fontSize: "0.9375rem",
                fontFamily: "var(--default-font-family)",
              }}
            />
            <Kbd>esc</Kbd>
          </Flex>

          {/* Command list */}
          <div
            role="listbox"
            aria-label="Command results"
            style={{
              maxHeight: "min(60vh, 24rem)",
              overflowY: "auto",
              padding: "0.5rem 0",
            }}
          >
            {filtered.length === 0 ? (
              <Flex
                align="center"
                justify="center"
                py="6"
                style={{ color: "var(--gray-11)" }}
              >
                <Text size="2">No matches.</Text>
              </Flex>
            ) : (
              filtered.map((cmd, index) => {
                const isActive = index === safeActiveIndex;
                return (
                  <button
                    key={cmd.id}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => {
                      void cmd.perform();
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.625rem 1rem",
                      background: isActive ? "var(--accent-a3)" : "transparent",
                      border: "none",
                      borderLeft: isActive
                        ? "2px solid var(--accent-9)"
                        : "2px solid transparent",
                      color: "var(--gray-12)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "var(--default-font-family)",
                      transition: "background 80ms ease-out",
                    }}
                  >
                    <span
                      style={{
                        color: isActive ? "var(--accent-11)" : "var(--gray-11)",
                        flexShrink: 0,
                        display: "inline-flex",
                      }}
                    >
                      {cmd.icon}
                    </span>
                    <Flex
                      direction="column"
                      gap="0"
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <Text
                        size="2"
                        weight="medium"
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {cmd.label}
                      </Text>
                      {cmd.hint && (
                        <Text
                          size="1"
                          style={{
                            color: "var(--gray-11)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {cmd.hint}
                        </Text>
                      )}
                    </Flex>
                    {isActive && <Kbd>↵</Kbd>}
                  </button>
                );
              })
            )}
          </div>

          {/* Footer with keyboard hints */}
          <Flex
            align="center"
            justify="between"
            px="4"
            py="2"
            gap="3"
            style={{
              borderTop: "1px solid var(--gray-a4)",
              color: "var(--gray-11)",
            }}
          >
            <Flex gap="3" align="center">
              <Flex gap="1" align="center">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                <Text size="1">navigate</Text>
              </Flex>
              <Flex gap="1" align="center">
                <Kbd>↵</Kbd>
                <Text size="1">select</Text>
              </Flex>
            </Flex>
            <Flex gap="1" align="center">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
              <Text size="1">to toggle</Text>
            </Flex>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
