import { useState } from "react";
import { SERVER_URL } from "./constants";
import { parseAccessions, startsWithAccession } from "./accessionLinks";
import { getProjectShortUrl } from "./shortUrl";

const HISTORY_KEY = "searchHistory";
const MAX_HISTORY = 5;
const VALID_DATABASES = new Set(["sra", "geo", "arrayexpress"]);

const buildSearchUrl = (query: string, db?: string | null) => {
  const params = new URLSearchParams();
  params.set("q", query);
  if (db && VALID_DATABASES.has(db)) {
    params.set("db", db);
  }
  return `/search?${params.toString()}`;
};

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch (e) {
          console.error("Failed to parse search history", e);
          return [];
        }
      }
    }
    return [];
  });

  const saveHistory = (newHistory: string[]) => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
    setHistory(newHistory);
  };

  const performSearch = async (
    query: string,
    navigate: (url: string) => void,
    db?: string | null,
  ) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const newHistory = [trimmed, ...history.filter((h) => h !== trimmed)].slice(
      0,
      MAX_HISTORY,
    );
    saveHistory(newHistory);

    // "<accession> ..." (optionally with a pasted title/notes) → jump to the
    // first recognized accession instead of full-text search. Any further
    // accessions in the text are ignored.
    if (startsWithAccession(trimmed)) {
      const first = parseAccessions(trimmed)[0];
      if (first) {
        if (first.isPrj) {
          // PRJ* needs a server round-trip to resolve to its GSE/SRP study.
          try {
            const res = await fetch(
              `${SERVER_URL}/prj/${encodeURIComponent(first.raw)}`,
            );
            if (res.status === 500) {
              alert("project not found");
              return;
            }
            if (!res.ok) {
              navigate(buildSearchUrl(trimmed, db));
              return;
            }
            const data = await res.json();
            const projectAccession =
              typeof data.project_accession === "string" &&
              data.project_accession
                ? data.project_accession
                : first.raw;
            navigate(getProjectShortUrl(projectAccession));
          } catch (error) {
            console.error("Error fetching project:", error);
            navigate(buildSearchUrl(trimmed, db));
          }
          return;
        }

        navigate(first.url);
        return;
      }
    }

    navigate(buildSearchUrl(trimmed, db));
  };

  return { history, saveHistory, performSearch };
}
