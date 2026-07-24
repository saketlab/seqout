import React from "react";

export type FindResult<T> = { rows: T[]; capped: boolean };

/**
 * Server-side accession lookup for a paginated grid.
 *
 * A grid that pages its rows in can only filter what it has loaded, so an
 * accession filter on a large study silently misses rows past the last page.
 * This resolves the filter against the whole study instead.
 *
 * `rows` is null while no lookup is active, meaning "show the paged rows".
 * Pass enabled=false when the loaded rows already are the whole study; the
 * grid's own client-side filter is correct then and no request is made.
 */
export function useServerFind<T>(
  enabled: boolean,
  /**
   * Resolve null when the server could not narrow on any supplied column —
   * an empty result then means "no answer", not "no matches", and the grid
   * keeps filtering its loaded rows instead of blanking.
   */
  fetchRows: (
    needle: string,
    signal: AbortSignal,
  ) => Promise<FindResult<T> | null>,
) {
  const [rows, setRows] = React.useState<T[] | null>(null);
  const [capped, setCapped] = React.useState(false);
  // A failed lookup must read differently from an empty one: on a 100k-row
  // study "no match" would otherwise imply the accession does not exist when
  // the search merely errored out.
  const [error, setError] = React.useState(false);
  const seqRef = React.useRef(0);
  const lastNeedleRef = React.useRef<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const debounceRef = React.useRef<number | null>(null);
  // Kept in a ref so callers can pass an inline closure without re-arming.
  const fetchRef = React.useRef(fetchRows);
  React.useEffect(() => {
    fetchRef.current = fetchRows;
  }, [fetchRows]);

  const reset = React.useCallback(() => {
    seqRef.current += 1; // drop any in-flight response
    abortRef.current?.abort();
    setRows(null);
    setCapped(false);
    setError(false);
  }, []);

  const search = React.useCallback(
    (needle: string) => {
      if (!enabled) return; // loaded rows are the whole study
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      const value = needle.trim();
      if (!value) {
        lastNeedleRef.current = null;
        reset();
        return;
      }
      // An unrelated client-side filter (a number range, say) fires
      // onFilterChanged too; re-issuing an identical lookup would abort the
      // in-flight request and ask the same question again.
      if (value === lastNeedleRef.current) return;
      lastNeedleRef.current = value;
      debounceRef.current = window.setTimeout(() => {
        const seq = ++seqRef.current;
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;
        setError(false);
        fetchRef
          .current(value, ac.signal)
          .then((data) => {
            if (seq !== seqRef.current) return; // a newer filter superseded this
            if (data === null) {
              // Server had nothing to say about these columns.
              setRows(null);
              setCapped(false);
              setError(false);
              return;
            }
            setRows(data.rows);
            setCapped(data.capped);
            setError(false);
          })
          .catch((err) => {
            if (ac.signal.aborted || seq !== seqRef.current) return;
            console.error("Accession lookup failed:", err);
            setRows([]);
            setCapped(false);
            setError(true);
          });
      }, 300);
    },
    [enabled, reset],
  );

  React.useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  return { rows, capped, error, search };
}
