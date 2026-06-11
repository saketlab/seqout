"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

// In-memory only: the last submitted query persists across client-side
// navigation between pages (the provider lives above the router outlet),
// but intentionally NOT across a full reload. We deliberately do NOT touch
// localStorage — the search bar should only show a query the user actually
// typed this session, never auto-fill itself on a fresh visit.
let currentQuery = "";

function readQuery(): string {
  return currentQuery;
}

function writeQuery(q: string): void {
  currentQuery = q;
}

// Multiple components subscribe in the same tab (e.g. the results page sets
// the query while the header bar reads it), so we run a small pub/sub to
// keep every subscriber in sync.
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
