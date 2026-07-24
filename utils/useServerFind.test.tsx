// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useServerFind } from "./useServerFind";

type Row = { id: string };

/** A fetch whose responses are resolved by hand, so ordering can be forced. */
const deferredFetch = () => {
  const calls: {
    needle: string;
    resolve: (rows: Row[]) => void;
    signal: AbortSignal;
  }[] = [];
  const fetchRows = vi.fn(
    (needle: string, signal: AbortSignal) =>
      new Promise<{ rows: Row[]; capped: boolean }>((res) => {
        calls.push({
          needle,
          signal,
          resolve: (rows) => res({ rows, capped: false }),
        });
      }),
  );
  return { calls, fetchRows };
};

const typeInto = (search: (v: string) => void, value: string) =>
  act(() => {
    search(value);
  });

const flushDebounce = () =>
  act(() => {
    vi.advanceTimersByTime(300);
  });

describe("useServerFind", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not hit the server when the loaded rows are the whole set", () => {
    const { fetchRows } = deferredFetch();
    const { result } = renderHook(() => useServerFind<Row>(false, fetchRows));

    typeInto(result.current.search, "SRX1");
    flushDebounce();

    expect(fetchRows).not.toHaveBeenCalled();
    expect(result.current.rows).toBeNull();
  });

  it("debounces to a single request for the latest value", () => {
    const { calls, fetchRows } = deferredFetch();
    const { result } = renderHook(() => useServerFind<Row>(true, fetchRows));

    typeInto(result.current.search, "SRX");
    typeInto(result.current.search, "SRX12");
    typeInto(result.current.search, "SRX123");
    flushDebounce();

    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(calls[0].needle).toBe("SRX123");
  });

  it("ignores a slow response that a newer lookup superseded", async () => {
    const { calls, fetchRows } = deferredFetch();
    const { result } = renderHook(() => useServerFind<Row>(true, fetchRows));

    typeInto(result.current.search, "SRX1");
    flushDebounce();
    typeInto(result.current.search, "SRX2");
    flushDebounce();
    expect(calls).toHaveLength(2);

    // The first request is aborted, and answering it late must not win.
    expect(calls[0].signal.aborted).toBe(true);
    await act(async () => {
      calls[1].resolve([{ id: "second" }]);
      calls[0].resolve([{ id: "first" }]);
    });

    expect(result.current.rows).toEqual([{ id: "second" }]);
  });

  it("clearing the filter drops back to the paged rows", async () => {
    const { calls, fetchRows } = deferredFetch();
    const { result } = renderHook(() => useServerFind<Row>(true, fetchRows));

    typeInto(result.current.search, "SRX1");
    flushDebounce();
    await act(async () => calls[0].resolve([{ id: "hit" }]));
    expect(result.current.rows).toEqual([{ id: "hit" }]);

    typeInto(result.current.search, "   ");
    expect(result.current.rows).toBeNull();
  });
});
