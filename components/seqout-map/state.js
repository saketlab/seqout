// Ported from saketlab-experiments/js/state.js
export const state = {
  colorByClusters: false,
  countryFilterName: null, // transform name for the country hide-filter
  selectedCountries: [], // currently selected countries (multi)
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
  state.countryFilterName = null;
  state.selectedCountries = [];
  state.currentSearchName = null;
  state.currentLassoName = null;
  state.lassoDataVerts = [];
  state.clusterColors = [];
  state.colorField = null;
  state.maxClusterId = 0;
}
