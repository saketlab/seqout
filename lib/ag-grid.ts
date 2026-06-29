import {
  AllCommunityModule,
  ModuleRegistry,
  type BodyScrollEvent,
  type ColDef,
} from "ag-grid-community";

let isAgGridRegistered = false;

export const ensureAgGridModules = () => {
  if (isAgGridRegistered) return;
  ModuleRegistry.registerModules([AllCommunityModule]);
  isAgGridRegistered = true;
};

/** Rows fetched per page for infinite-scroll tables. */
export const TABLE_PAGE_SIZE = 20;

/** Wrap-text fields honoring the user's wrap toggle (see useWrapText). */
export const wrapColDef = <T>(
  wrap: boolean,
): Pick<ColDef<T>, "wrapText" | "autoHeight"> => ({
  wrapText: wrap,
  autoHeight: wrap,
});

/**
 * defaultColDef fragment for dense text tables: truncate with an ellipsis when
 * wrapping is off, grow to fit when it's on.
 */
export const truncatableColDef = <T>(
  wrap: boolean,
): Pick<ColDef<T>, "wrapText" | "autoHeight" | "cellStyle"> => ({
  ...wrapColDef<T>(wrap),
  cellStyle: {
    fontSize: "14px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: wrap ? "normal" : "nowrap",
  },
});

/**
 * onBodyScroll handler for infinite-scroll grids backed by useInfiniteQuery:
 * fetches the next page once the viewport nears the end of the loaded rows.
 */
export function infiniteScrollOnBodyScroll(opts: {
  loadedCount: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}) {
  return (e: BodyScrollEvent) => {
    if (!opts.hasNextPage || opts.isFetchingNextPage) return;
    if (e.api.getLastDisplayedRowIndex() >= opts.loadedCount - 5) {
      opts.fetchNextPage();
    }
  };
}
