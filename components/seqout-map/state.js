// Ported from saketlab-experiments/js/state.js
export const state = {
  colorByClusters: false,
  colorBySource: false, // color points by their archive (source) instead
  sourceDomain: null, // archive strings in index order, e.g. ["geo","sra",...]
  sourceRange: null, // hex colors parallel to sourceDomain
  filterName: null, // transform name for the country hide-filter
  filters: {}, // active facets: column -> Set of selected values (AND across cols)
  facetColumns: [], // enriched facet tile columns to tally for the lasso stats
  currentSearchName: null,
  currentLassoName: null,
  lassoDataVerts: [],
  clusterColors: [],
  colorField: null, // source tile column for the current zoom's cluster layer
  // Numeric transform of colorField. This avoids deepscatter's 4,096-entry
  // categorical-color texture, which cannot represent the fine cluster layers.
  colorValueField: null,
  maxClusterId: 0, // max cluster id at that layer (color domain)
  mapExtent: null,
};

// Reset the singleton state between mounts (React client navigation / StrictMode).
export function resetState() {
  state.colorByClusters = false;
  state.colorBySource = false;
  state.sourceDomain = null;
  state.sourceRange = null;
  state.filterName = null;
  state.filters = {};
  state.facetColumns = [];
  state.currentSearchName = null;
  state.currentLassoName = null;
  state.lassoDataVerts = [];
  state.clusterColors = [];
  state.colorField = null;
  state.colorValueField = null;
  state.maxClusterId = 0;
  state.mapExtent = null;
}
