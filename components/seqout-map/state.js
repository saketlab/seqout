// Ported from saketlab-experiments/js/state.js
export const state = {
  colorByClusters: false,
  filterName: null, // transform name for the country hide-filter
  filters: {}, // active facets: column -> Set of selected values (AND across cols)
  facetColumns: [], // enriched facet tile columns to tally for the lasso stats
  currentSearchName: null,
  currentLassoName: null,
  lassoDataVerts: [],
  clusterColors: [],
  colorField: null, // tile column for the current zoom's cluster layer
  maxClusterId: 0, // max cluster id at that layer (color domain)
};

// Reset the singleton state between mounts (React client navigation / StrictMode).
export function resetState() {
  state.colorByClusters = false;
  state.filterName = null;
  state.filters = {};
  state.facetColumns = [];
  state.currentSearchName = null;
  state.currentLassoName = null;
  state.lassoDataVerts = [];
  state.clusterColors = [];
  state.colorField = null;
  state.maxClusterId = 0;
}
