// Ported from saketlab-experiments/js/state.js
export const state = {
  colorByClusters: false,
  currentFilterName: null,
  currentSearchName: null,
  currentLassoName: null,
  countryFilterData: { selectedCountries: [], countryToIndex: {}, colors: [] },
  lassoDataVerts: [],
  clusterColors: [],
  numClusters: 0,
};

// Reset the singleton state between mounts (React client navigation / StrictMode).
export function resetState() {
  state.colorByClusters = false;
  state.currentFilterName = null;
  state.currentSearchName = null;
  state.currentLassoName = null;
  state.countryFilterData = { selectedCountries: [], countryToIndex: {}, colors: [] };
  state.lassoDataVerts = [];
  state.clusterColors = [];
  state.numClusters = 0;
}
