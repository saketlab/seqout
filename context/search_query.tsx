"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const STORAGE_KEY = "seqout:last-search-query";

// Fallback for SSR and privacy-mode browsers where localStorage throws.
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

// localStorage's native "storage" event only fires in other tabs, so
// we run our own pub/sub for same-tab writes.
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
