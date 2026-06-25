import {
  AllCommunityModule,
  ModuleRegistry,
  type BodyScrollEvent,
} from "ag-grid-community";

let isAgGridRegistered = false;

export const ensureAgGridModules = () => {
  if (isAgGridRegistered) return;
  ModuleRegistry.registerModules([AllCommunityModule]);
  isAgGridRegistered = true;
};

/** Rows fetched per page for infinite-scroll tables. */
export const TABLE_PAGE_SIZE = 20;

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
