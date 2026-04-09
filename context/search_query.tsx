"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * SearchQueryProvider — keeps the user's most recent search query
 * available across route navigations so the sticky search bar can
 * re-display it when the user lands on a project / sample / FAQ page
 * after clicking a result card.
 *
 * Persistence: backed by localStorage via useSyncExternalStore so the
 * value survives:
 *   - React Suspense boundary remounts during App Router navigation
 *   - React Strict Mode double-invocation in dev
 *   - Full page reloads (the user's last query is still in the bar)
 *
 * The Provider is mounted once at the app root via `<Wrapper>`. We use
 * useSyncExternalStore (the React-blessed external-store pattern)
 * because the simpler useState + useEffect approach trips the React
 * Compiler's `react-hooks/set-state-in-effect` rule.
 */

const STORAGE_KEY = "seqout:last-search-query";

// In-memory fallback for server snapshots and privacy-mode browsers
// where localStorage throws.
let memoryFallback = "";

function readQuery(): string {
  if (typeof window === "undefined") return memoryFallback;
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return memoryFallback;
  }
}

function writeQuery(q: string): void {
  memoryFallback = q;
  if (typeof window === "undefined") return;
  try {
    if (q) {
      window.localStorage.setItem(STORAGE_KEY, q);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* privacy-mode browsers — silently skip */
  }
}

// Module-level pub/sub so useSyncExternalStore re-renders all
// consumers when writeQuery is called from anywhere in the app.
// localStorage's native "storage" event only fires for OTHER tabs,
// not the current one, so we maintain our own listener set.
const listeners = new Set<() => void>();
function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}
function notifyListeners() {
  listeners.forEach((l) => l());
}

// Server snapshot: always empty string. Matches the initial client
// render (before any localStorage hydration), preventing hydration
// mismatches. After hydration, useSyncExternalStore re-runs getSnapshot
// on the client and updates if the localStorage value differs.
function getServerSnapshot(): string {
  return "";
}

type SearchQueryContextValue = {
  lastSearchQuery: string;
  setLastSearchQuery: (q: string) => void;
};

const SearchQueryContext = createContext<SearchQueryContextValue>({
  lastSearchQuery: "",
  setLastSearchQuery: () => {},
});

export function SearchQueryProvider({ children }: { children: ReactNode }) {
  const lastSearchQuery = useSyncExternalStore(
    subscribe,
    readQuery,
    getServerSnapshot,
  );

  const setLastSearchQuery = useCallback((q: string) => {
    writeQuery(q);
    notifyListeners();
  }, []);

  const value = useMemo<SearchQueryContextValue>(
    () => ({ lastSearchQuery, setLastSearchQuery }),
    [lastSearchQuery, setLastSearchQuery],
  );

  return (
    <SearchQueryContext.Provider value={value}>
      {children}
    </SearchQueryContext.Provider>
  );
}

export function useSearchQuery() {
  return useContext(SearchQueryContext);
}
