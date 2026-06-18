// DOM-free deepscatter engine. All the visualization logic ported from the
// original saketlab modules (index/search/country-filter/lasso) lives here;
// it only ever touches the Scatterplot instance and the shared `state` object.
// The React component (seqout-map.tsx) owns all UI and calls into these.
import { Scatterplot } from "deepscatter";
import { hsl } from "d3-color";

import { state, resetState } from "./state.js";
import { applyTransformation, applyColorEncoding, restoreForeground, pointInPolygon } from "./utils.js";
import {
  COLOR_PALETTE_SIZE,
  HUE_GOLDEN_ANGLE,
  DEFAULT_BG_OPACITY,
  DEFAULT_BG_SIZE,
  DEFAULT_BG_COLOR,
  LASSO_DIM_OPACITY,
  LASSO_DIM_SIZE,
  LASSO_BG_COLOR,
} from "./constants.js";

export { restoreForeground };

function generateGoldenAnglePalette(n) {
  return Array.from({ length: n }, (_, i) => {
    const hue = (i * HUE_GOLDEN_ANGLE) % 360;
    const sat = 0.55 + ((i >> 1) % 2) * 0.35;
    const light = 0.45 + ((i >> 2) % 2) * 0.15;
    return hsl(hue, sat, light).formatHex();
  });
}

function buildCountryColorMap(sorted) {
  /** @type {Record<string, string>} */
  const map = {};
  sorted.forEach((country, i) => {
    const hue = (i * HUE_GOLDEN_ANGLE) % 360;
    map[country] = hsl(hue, 0.7, 0.55).formatHex();
  });
  return map;
}

function buildColorEncoding(name, colors, selectedLength) {
  if (state.colorByClusters) {
    return { field: "cluster_id", range: state.clusterColors, domain: [1, state.numClusters] };
  }
  return { field: name, range: colors, domain: [0, selectedLength] };
}

// Create the scatterplot from already-fetched map assets. The React layer owns
// fetching/caching of `geojson` and `countries` and passes the tiles URL
// (deepscatter source_url); this keeps all networking/caching out of the engine.
// The caller is responsible for the `onPick` callback wiring.
// deepscatter draws cluster labels onto a canvas and hardcodes both a 12px
// shadowBlur and a grey strokeText outline every frame. No option exposes
// either, so wrap the label renderer's ctx: clamp shadowBlur to 0 and drop the
// stroke (its canvas is label-only, so a no-op strokeText is safe). The white
// fillText stays. ponytail: instance proxy beats forking the library.
function killLabelShadow(sp, name) {
  const lm = sp.secondary_renderers?.[name];
  if (!lm) return;
  lm.ctx = new Proxy(lm.ctx, {
    get(t, p) {
      if (p === "strokeText") return () => {};
      const v = t[p];
      return typeof v === "function" ? v.bind(t) : v;
    },
    set(t, p, v) { t[p] = p === "shadowBlur" ? 0 : v; return true; },
  });
}

export async function createMap({ mapSelector, width, height, tilesUrl, geojson, countries, backgroundColor, labelFont, onPick }) {
  resetState();

  const clusters = geojson.features;

  const clusterColors = generateGoldenAnglePalette(COLOR_PALETTE_SIZE);
  state.clusterColors = clusterColors;
  state.numClusters = clusters.length;
  const sortedCountries = [...countries].sort();
  const countryColorMap = buildCountryColorMap(sortedCountries);

  const sp = new Scatterplot(mapSelector, width, height);

  await sp.plotAPI({
    source_url: tilesUrl,
    max_points: 1000000,
    alpha: 25,
    zoom_balance: 0.7,
    duration: 500,
    point_size: 0.7,
    background_color: backgroundColor,
    encoding: {
      x: { field: "x", transform: "literal" },
      y: { field: "y", transform: "literal" },
      color: { constant: "#4CAF50" },
    },
  });

  sp.add_labels(geojson, "clusters", "title", undefined, labelFont ? { font: labelFont } : {});
  killLabelShadow(sp, "clusters");
  sp.tooltip_html = (datum) => `<strong>${datum.accession ?? "unknown"}</strong>`;

  // Point click -> resolve accession, hand off to the React layer (which fetches
  // metadata and renders the sidebar). Set here because deepscatter's
  // click_function signature is library-owned; assigning it in TS would fight
  // the types for no benefit.
  if (onPick) {
    sp.click_function = async (datum) => {
      const accession = await resolveAccession(sp, datum);
      if (!accession) return;
      onPick({ accession, clusterId: datum.cluster_id });
    };
  }

  sp.ready.then(() => {
    const dt = sp.deeptable;
    const origSpawn = dt.spawnDownloads.bind(dt);
    dt.spawnDownloads = (bbox, maxIx, qLen, fields, priority) => {
      const extra = ["accession", "cluster_id", "countries"].filter((f) => !fields.includes(f));
      return origSpawn(bbox, maxIx, qLen, [...fields, ...extra], priority);
    };
    sp.plotAPI({ background_options: { opacity: [0.6, 1], size: [0.7, 1] } });
  });

  return { sp, clusters, countries: sortedCountries, countryColorMap, clusterColors };
}

export function setBackgroundColor(sp, backgroundColor) {
  sp.plotAPI({ duration: 0, background_color: backgroundColor });
}

/** Resolve the accession for a clicked datum (may require a tile transform). */
export async function resolveAccession(sp, datum) {
  let accession = datum.accession;
  if (!accession) {
    const r = await sp.deeptable.applyTransformationToPoint("accession", datum.ix);
    accession = r.accession;
  }
  return accession;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
export async function runSearch(sp, accessionId) {
  const dt = sp.deeptable;

  if (state.currentSearchName) {
    delete dt.transformations[state.currentSearchName];
    state.currentSearchName = null;
  }

  const name = "sr_" + Date.now();
  state.currentSearchName = name;

  const selection = await dt.select_data({ name, ids: [accessionId], idField: "accession" });
  await selection.applyToAllTiles();

  let found = null;
  for (const point of selection) {
    found = { x: point.x, y: point.y, accession: point.accession };
    break;
  }

  if (found) {
    await sp.plotAPI({
      duration: 300,
      encoding: { foreground: { field: name, op: "eq", a: 1 } },
      background_options: { color: DEFAULT_BG_COLOR, opacity: DEFAULT_BG_OPACITY, size: DEFAULT_BG_SIZE },
    });
    sp.zoom.zoom_to(30, found.x, found.y, 500);
  }

  return found;
}

export function clearSearch(sp) {
  const dt = sp.deeptable;
  if (state.currentSearchName) {
    delete dt.transformations[state.currentSearchName];
    state.currentSearchName = null;
  }
  restoreForeground(sp);
}

// ---------------------------------------------------------------------------
// Country filter (single selection)
// ---------------------------------------------------------------------------
export async function applyCountryFilter(sp, selectedCountry, countryColorMap, clusterColors, clusters) {
  const dt = sp.deeptable;
  const oldFilterName = state.currentFilterName;

  if (!selectedCountry) {
    state.currentFilterName = null;
    state.countryFilterData = { selectedCountries: [], countryToIndex: {}, colors: [] };
    if (state.currentLassoName) {
      await reapplyLasso(sp);
    }
    applyColorEncoding(sp, clusterColors, clusters);
    if (oldFilterName) delete dt.transformations[oldFilterName];
    return;
  }

  const selected = [selectedCountry];
  const name = "cf_" + Date.now();
  state.currentFilterName = name;

  const countryToIndex = {};
  selected.forEach((c, i) => { countryToIndex[c] = i + 1; });

  state.countryFilterData = {
    selectedCountries: selected,
    countryToIndex,
    colors: selected.map((c) => countryColorMap[c]),
  };

  const colors = selected.map((c) => countryColorMap[c]);
  const colorEnc = buildColorEncoding(name, colors, selected.length);
  const splitMemo = new Map();
  const lassoActive = state.currentLassoName && state.lassoDataVerts.length > 0;

  const matchIndex = (row, requirePolygon, dataVerts) => {
    if (requirePolygon && !pointInPolygon(row.x, row.y, dataVerts)) return 0;
    const v = row.countries;
    if (!v) return 0;
    let parts = splitMemo.get(v);
    if (!parts) {
      parts = v.split(";");
      splitMemo.set(v, parts);
    }
    for (let i = 0; i < parts.length; i++) {
      const idx = countryToIndex[parts[i]];
      if (idx !== undefined) return idx;
    }
    return 0;
  };

  if (lassoActive) {
    const dataVerts = state.lassoDataVerts;
    await applyTransformation(sp, name, (row) => matchIndex(row, true, dataVerts));
    sp.plotAPI({
      duration: 0,
      encoding: { foreground: { field: name, op: "gt", a: 0 }, color: colorEnc },
      background_options: { color: LASSO_BG_COLOR, opacity: LASSO_DIM_OPACITY, size: LASSO_DIM_SIZE },
    });
  } else {
    await applyTransformation(sp, name, (row) => matchIndex(row, false, null));
    sp.plotAPI({
      duration: 0,
      encoding: { foreground: { field: name, op: "gt", a: 0 }, color: colorEnc },
      background_options: { color: DEFAULT_BG_COLOR, opacity: DEFAULT_BG_OPACITY, size: DEFAULT_BG_SIZE },
    });
  }

  if (oldFilterName) delete dt.transformations[oldFilterName];
}

export function setColorByClusters(sp, value, clusterColors, clusters) {
  state.colorByClusters = value;
  applyColorEncoding(sp, clusterColors, clusters);
}

// ---------------------------------------------------------------------------
// Lasso
// ---------------------------------------------------------------------------
export function screenToData(sp, screenX, screenY) {
  try {
    const scales = sp.zoom.scales();
    if (scales) return { x: scales.x_.invert(screenX), y: scales.y_.invert(screenY) };
  } catch (err) {
    console.warn("screenToData failed:", err);
  }
  return { x: screenX, y: screenY };
}

export async function performLasso(sp, dataVerts) {
  state.lassoDataVerts = dataVerts;

  const dt = sp.deeptable;
  if (state.currentLassoName) delete dt.transformations[state.currentLassoName];

  const name = "ls_" + Date.now();
  state.currentLassoName = name;

  if (state.currentFilterName) {
    const cfData = state.countryFilterData;
    await applyTransformation(sp, name, (row) => {
      if (!pointInPolygon(row.x, row.y, dataVerts)) return 0;
      const parts = row.countries?.split(";") ?? [];
      for (const part of parts) {
        const idx = cfData.countryToIndex[part];
        if (idx !== undefined) return idx;
      }
      return 0;
    });
    sp.plotAPI({
      duration: 0,
      encoding: {
        foreground: { field: name, op: "gt", a: 0 },
        color: buildColorEncoding(name, cfData.colors, cfData.selectedCountries.length),
      },
      background_options: { color: LASSO_BG_COLOR, opacity: LASSO_DIM_OPACITY, size: LASSO_DIM_SIZE },
    });
  } else {
    await applyTransformation(sp, name, (row) => (pointInPolygon(row.x, row.y, dataVerts) ? 1 : 0));
    sp.plotAPI({
      duration: 0,
      encoding: { foreground: { field: name, op: "eq", a: 1 } },
      background_options: { color: LASSO_BG_COLOR, opacity: LASSO_DIM_OPACITY, size: LASSO_DIM_SIZE },
    });
  }
}

export function clearLasso(sp) {
  const dt = sp.deeptable;
  if (state.currentLassoName) {
    delete dt.transformations[state.currentLassoName];
    state.currentLassoName = null;
  }
  state.lassoDataVerts = [];
  restoreForeground(sp);
}

export async function reapplyLasso(sp) {
  if (!state.lassoDataVerts.length) return;
  const dt = sp.deeptable;
  if (state.currentLassoName) delete dt.transformations[state.currentLassoName];
  const name = "ls_" + Date.now();
  state.currentLassoName = name;
  const dataVerts = state.lassoDataVerts;
  await applyTransformation(sp, name, (row) => (pointInPolygon(row.x, row.y, dataVerts) ? 1 : 0));
}

export function hasLassoSelection() {
  return state.currentLassoName !== null;
}

export async function collectLassoData(sp) {
  const selectionName = state.currentLassoName;
  const dt = sp.deeptable;
  const accessions = [];
  const countryCounts = {};

  for (const tile of dt.map((t) => t)) {
    if (!tile.record_batch || !tile.hasLoadedColumn(selectionName)) continue;

    const col = tile.record_batch.getChild(selectionName);
    const accCol = tile.record_batch.getChild("accession");
    const countriesCol = tile.record_batch.getChild("countries");
    if (!col || !accCol) continue;

    for (let i = 0; i < col.length; i++) {
      if (col.get(i) < 0.5) continue;
      const acc = accCol.get(i);
      if (acc) accessions.push(acc);
      if (countriesCol) {
        const v = countriesCol.get(i);
        if (v) v.split(";").filter(Boolean).forEach((c) => { countryCounts[c] = (countryCounts[c] || 0) + 1; });
      }
    }
  }

  const sortedCountries = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]);
  const topCountries = sortedCountries.slice(0, 5);
  const otherCount = sortedCountries.slice(5).reduce((s, [, c]) => s + c, 0);
  if (otherCount > 0) topCountries.push(["Other", otherCount]);

  return { accessions, countryCount: Object.keys(countryCounts).length, topCountries };
}

export async function fetchOrganismCounts(accessions, apiBase) {
  // server caps each request at 100 accessions; fetch in chunks
  const chunks = [];
  for (let i = 0; i < accessions.length; i += 100) chunks.push(accessions.slice(i, i + 100));
  const data = (await Promise.all(chunks.map(async (batch) => {
    const res = await fetch(`${apiBase}/bulk/project-metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessions: batch }),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }))).flat();

  const counts = {};
  let unknownCount = 0;
  for (const item of data) {
    const orgs = item.organisms;
    if (orgs && orgs.length > 0) {
      for (const org of orgs) { if (org) counts[org] = (counts[org] || 0) + 1; }
    } else {
      unknownCount++;
    }
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 5);
  unknownCount += sorted.slice(5).reduce((s, [, c]) => s + c, 0);
  if (unknownCount > 0) top.push(["Unknown", unknownCount]);
  return top;
}
