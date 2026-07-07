// DOM-free deepscatter engine. All the visualization logic ported from the
// original saketlab modules (index/search/country-filter/lasso) lives here;
// it only ever touches the Scatterplot instance and the shared `state` object.
// The React component (seqout-map.tsx) owns all UI and calls into these.
import { hsl } from "d3-color";
import { Scatterplot } from "deepscatter";

import {
  COLOR_PALETTE_SIZE,
  DEFAULT_BG_COLOR,
  DEFAULT_BG_OPACITY,
  DEFAULT_BG_SIZE,
  HUE_GOLDEN_ANGLE,
  LASSO_BG_COLOR,
  LASSO_DIM_OPACITY,
  LASSO_DIM_SIZE,
} from "./constants.js";
import { resetState, state } from "./state.js";
import {
  applyColorEncoding,
  applyTransformation,
  pointInPolygon,
  restoreForeground,
} from "./utils.js";

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

// Initial view: data-space point the map is centered on, and the fraction of the
// data extent shown around it on load. fraction < 1 zooms in past full-fit;
// smaller = more zoomed in.
const DEFAULT_CENTER = { x: 1.1495, y: -1.5695 };
const DEFAULT_VIEW_FRACTION = 0.5;
const SEARCH_VIEW_FRACTION = 0.02;
const DOUBLE_CLICK_MS = 350;

// Cap the description shown in the hover tooltip (words).
const TOOLTIP_DESC_WORDS = 40;
const capWords = (s) => {
  const words = s.trim().split(/\s+/);
  return words.length > TOOLTIP_DESC_WORDS
    ? words.slice(0, TOOLTIP_DESC_WORDS).join(" ") + "…"
    : s;
};
const HTML_ESC = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => HTML_ESC[c]);

// Create the scatterplot. The React layer passes the tiles URL (deepscatter
// source_url), the country list, and the label config (layers/extent/color
// layer). Labels are the one thing fetched from inside the engine — the dynamic
// system below needs the live zoom/viewport, so it owns those requests.
// The caller is responsible for the `onPick` callback wiring.
// Current label text color, kept in sync with the theme (white on dark bg,
// near-black on light). The proxy below remaps deepscatter's hardcoded white.
let labelColor = "#ffffff";
const labelColorFor = (bg) => (bg === "#ffffff" ? "#1a1a1a" : "#ffffff");

// Color for noise points (cluster -1) when coloring by cluster. deepscatter
// forces palette colors fully opaque, so instead of real transparency we use a
// faint near-background grey — noise fades out and the colored clusters pop.
const noiseColorFor = (bg) => (bg === "#ffffff" ? "#f0f0f0" : "#141414");

// deepscatter draws cluster labels onto a canvas and hardcodes a 12px shadowBlur,
// a grey strokeText outline, and white fill text every frame. No option exposes
// any of these, so wrap the label renderer's ctx: clamp shadowBlur to 0, drop
// the stroke (its canvas is label-only, so a no-op strokeText is safe), and remap
// the white fill to the themed color. ponytail: instance proxy beats forking.
function killLabelShadow(sp, name) {
  const lm = sp.secondary_renderers?.[name];
  if (!lm) return;
  lm.ctx = new Proxy(lm.ctx, {
    get(t, p) {
      if (p === "strokeText") return () => {};
      const v = t[p];
      return typeof v === "function" ? v.bind(t) : v;
    },
    set(t, p, v) {
      if (p === "shadowBlur") v = 0;
      else if (p === "fillStyle" && v === "white") v = labelColor;
      t[p] = v;
      return true;
    },
  });
  // deepscatter bumps the font (+ shadow/stroke) by `emphasize` while a label is
  // hovered, driven by lm.hovered. Pin it undefined so hover never resizes labels.
  try {
    Object.defineProperty(lm, "hovered", {
      get() {
        return undefined;
      },
      set() {},
      configurable: true,
    });
  } catch {
    /* ignore */
  }
}

export async function createMap({
  mapSelector,
  width,
  height,
  tilesUrl,
  labelsBase,
  clusterMax,
  clusterCount,
  levels,
  extent,
  countries,
  filterColumns,
  backgroundColor,
  labelFont,
  serverUrl,
  maxPoints = 1000000,
  labelLimit = LABEL_LIMIT,
  pointSize = 0.1,
  alpha = 25,
  initialDuration = 500,
}) {
  const facetColumns = filterColumns ?? [];
  resetState();
  state.facetColumns = facetColumns; // after resetState (which clears it)
  state.mapExtent = extent;

  // Points are colored by their cluster at the layer matching the current zoom
  // (a per-layer sidecar column in the tiles, kept in state.colorField). Seed it
  // with the coarsest labeled layer for the default view; the zoom listener keeps
  // it in sync. cluster ids run [0, max] and -1 = noise (grey, first palette slot).
  state.colorField =
    levels[Math.min(LABEL_LAYER_MAX, levels.length - 1)] ?? null;
  state.maxClusterId = (state.colorField && clusterMax[state.colorField]) || 0;

  // Index 0 of the range maps to cluster_id -1 (noise) → faint background grey so
  // noise fades out; real clusters interpolate across the golden-angle palette.
  const clusterColors = [
    noiseColorFor(backgroundColor),
    ...generateGoldenAnglePalette(COLOR_PALETTE_SIZE),
  ];
  state.clusterColors = clusterColors;
  const sortedCountries = [...countries].sort();
  const countryColorMap = buildCountryColorMap(sortedCountries);

  // deepscatter writes these straight onto the canvas width/height attributes and
  // sizes its regl framebuffers from them; fractional values (sub-pixel
  // getBoundingClientRect) make regl round the FBO and its texture differently →
  // "inconsistent width/height for supplied texture". Round to whole pixels.
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const sp = new Scatterplot(mapSelector, w, h);

  // Center the initial view on the data and start zoomed in past full-fit. Without
  // an explicit zoom, deepscatter leaves the transform at identity (origin top-left
  // → off-center). DEFAULT_VIEW_FRACTION < 1 fits a centered sub-box, so smaller =
  // more zoomed in.
  const cx = DEFAULT_CENTER.x;
  const cy = DEFAULT_CENTER.y;
  const hw = ((extent.maxx - extent.minx) / 2) * DEFAULT_VIEW_FRACTION || 1;
  const hh = ((extent.maxy - extent.miny) / 2) * DEFAULT_VIEW_FRACTION || 1;

  await sp.plotAPI({
    source_url: tilesUrl,
    max_points: maxPoints,
    alpha,
    zoom_balance: 0.7,
    duration: initialDuration,
    point_size: pointSize,
    background_color: backgroundColor,
    zoom: { bbox: { x: [cx - hw, cx + hw], y: [cy - hh, cy + hh] } },
    encoding: {
      x: { field: "x", transform: "literal" },
      y: { field: "y", transform: "literal" },
      color: { constant: "#4CAF50" },
    },
  });

  labelColor = labelColorFor(backgroundColor);

  // Hover/click tooltip (deepscatter positions this box at the point):
  //   hover -> just the accession + a "Click to show details" hint
  //   click -> pin that accession and show its title + description (fetched once,
  //            cached). Only the clicked accession shows details; everything else
  //            stays on the hint. When the fetch resolves we re-fire deepscatter's
  //            hover at the last cursor position so the box updates immediately.
  const metaCache = new Map(); // accession -> meta | "loading"
  let clickedAccession = null;
  let lastClickedAccession = null;
  let lastClickAt = 0;
  let highlitPointIds = [];
  let lastMove = null;
  const svgEl = () => document.querySelector(`${mapSelector} #deepscatter-svg`);
  sp.highlit_point_change = (points) => {
    highlitPointIds = points;
  };
  sp.ready.then(() => {
    svgEl()?.addEventListener("mousemove", (e) => {
      lastMove = { clientX: e.clientX, clientY: e.clientY };
    });
    // deepscatter drops label hit-box <rect>s into #labelrects (inside the
    // interaction SVG); they steal pointer events so points under a label become
    // unhoverable. We don't use label clicks, so make the whole group transparent
    // to the pointer — hovers fall through the text to the points beneath.
    const labelrects = svgEl()?.querySelector("#labelrects");
    if (labelrects) labelrects.style.pointerEvents = "none";
  });
  const refreshTooltip = () => {
    const tooltips = document.querySelectorAll(`${mapSelector} .tooltip`);
    if (tooltips.length > 0 && highlitPointIds.length > 0) {
      tooltips.forEach((tooltip, i) => {
        const pointId = highlitPointIds[i];
        if (pointId != null) {
          tooltip.innerHTML = sp.tooltip_handler.f(pointId, sp);
        }
      });
      return;
    }

    const el = svgEl();
    if (el && lastMove)
      el.dispatchEvent(
        new MouseEvent("mousemove", { ...lastMove, bubbles: true }),
      );
  };
  const fetchMeta = async (accession) => {
    if (metaCache.has(accession)) return;
    metaCache.set(accession, "loading");
    try {
      const res = await fetch(`${serverUrl}/project/${accession}/metadata`);
      metaCache.set(accession, res.ok ? await res.json() : null);
    } catch {
      metaCache.set(accession, null);
    }
    refreshTooltip();
  };
  const handlePointClick = (accession) => {
    if (!accession) return;
    const now = Date.now();
    const isDoubleClick =
      accession === lastClickedAccession &&
      now - lastClickAt <= DOUBLE_CLICK_MS;
    lastClickedAccession = accession;
    lastClickAt = now;

    if (isDoubleClick) {
      window.open(`/p/${encodeURIComponent(accession)}`, "_blank", "noopener");
      return;
    }

    clickedAccession = accession;
    refreshTooltip(); // switch to details/loading right away
    fetchMeta(accession); // fetch if needed; refreshes again on resolve
  };
  sp.click_function = (datum) => {
    if (datum.accession) {
      handlePointClick(datum.accession);
      return;
    }
    resolveAccession(sp, datum).then(handlePointClick);
  };
  sp.tooltip_html = (datum) => {
    const accession = datum.accession ?? "unknown";
    if (accession !== clickedAccession) {
      return (
        `<div><strong style="font-size:1rem">${esc(accession)}</strong>` +
        `<div style="margin-top:4px;font-size:0.9rem;opacity:.9">Click to show details</div>` +
        `<div style="margin-top:4px;font-size:0.9rem;opacity:.9">Double click to open in new tab</div></div>`
      );
    }
    const meta = metaCache.get(accession);
    const ready = meta && meta !== "loading";
    const title = ready ? meta.title : "";
    const description = ready ? meta.description : "";
    const descShort = description ? capWords(description) : "";
    return (
      `<div>` +
      `<div style="margin-top:4px;font-size:0.9rem;opacity:.9">Double click to open in new tab</div></div>` +
      `<strong style="font-size:1rem">${esc(accession)}</strong>` +
      (title
        ? `<div style="margin-top:4px;font-weight:500;font-size:1.2rem">${esc(title)}</div>`
        : "") +
      (descShort
        ? `<div style="margin-top:4px;font-size:1rem;opacity:.9">${esc(descShort)}</div>`
        : "") +
      (ready
        ? ""
        : `<div style="margin-top:4px;font-size:11px;opacity:.6">Loading…</div>`) +
      `</div>`
    );
  };

  // Dynamic labels + zoom-driven point coloring: only the layer matching the
  // current zoom is used, for both labels and (when enabled) cluster colors.
  const labels = setupDynamicLabels({
    sp,
    labelsBase,
    levels,
    extent,
    labelFont,
    clusterMax,
    clusterCount,
    labelLimit,
  });

  sp.ready.then(() => {
    const dt = sp.deeptable;
    const origSpawn = dt.spawnDownloads.bind(dt);
    dt.spawnDownloads = (bbox, maxIx, qLen, fields, priority) => {
      const extra = ["accession", "countries", ...facetColumns].filter(
        (f) => !fields.includes(f),
      );
      return origSpawn(bbox, maxIx, qLen, [...fields, ...extra], priority);
    };
    sp.plotAPI({ background_options: { opacity: [0.6, 1], size: [0.7, 1] } });
    labels.start(); // initial fetch + attach the zoom/pan listener
  });

  return {
    sp,
    countries: sortedCountries,
    countryColorMap,
    clusterColors,
    destroy: labels.destroy,
  };
}

// ---------------------------------------------------------------------------
// Dynamic labels — fetch per viewport + zoom layer
// ---------------------------------------------------------------------------
const LABEL_DEBOUNCE_MS = 220;
const LABEL_LIMIT = 400;
const LABEL_BBOX_MARGIN = 0.25; // prefetch slightly past the screen for smooth pans

// Only these cluster layers ever get labels (cluster_l0…l3, by array index =
// cluster_lN suffix). When the zoom is coarser than l3, no labels are shown at
// all — labels appear only once the user is zoomed into the l0…l3 range.
const LABEL_LAYER_MIN = 0; // finest labeled layer (cluster_l0)
const LABEL_LAYER_MAX = 3; // coarsest labeled layer (cluster_l3)
// deepscatter packs categorical colors into a 4096-tall texture indexed by the
// column's dictionary, so a layer with more clusters than this can't be colored
// (its points would overflow the texture → black). Coloring won't go finer than
// the finest layer under this limit.
const COLOR_CATEGORY_LIMIT = 4096;

// Map the current zoom to a labeled layer (one layer per 2x zoom). Returns
// level: null when zoomed out past l3, so nothing is shown unless the user is
// actually within the l0…l3 zoom range.
function computeLevelAndBbox(sp, levels, extent) {
  const corners = sp.zoom.current_corners();
  const vminx = corners.x[0];
  const vmaxx = corners.x[1];
  const vminy = corners.y[0];
  const vmaxy = corners.y[1];
  const vw = Math.abs(vmaxx - vminx) || 1e-9;
  const tw = Math.abs(extent.maxx - extent.minx) || vw;
  const depth = Math.max(0, Math.log2(tw / vw));
  const mx = (vmaxx - vminx) * LABEL_BBOX_MARGIN;
  const my = (vmaxy - vminy) * LABEL_BBOX_MARGIN;
  const bbox = {
    minx: vminx - mx,
    maxx: vmaxx + mx,
    miny: vminy - my,
    maxy: vmaxy + my,
  };

  const L = levels.length;
  if (L === 0) return { level: null, colorIdx: null, ...bbox };
  const showMax = Math.min(LABEL_LAYER_MAX, L - 1);
  const showMin = Math.min(LABEL_LAYER_MIN, showMax);
  // Anchored so depth 0 (fully zoomed out) lands one layer above the window → no
  // labels; each zoom-in step moves one layer finer.
  const idx = showMax + 1 - Math.round(depth);
  // colorIdx: same mapping but clamped into the window (never null), so colored
  // points keep a sensible layer even when labels are hidden (zoomed out). The
  // caller may clamp it further to a layer small enough for the color texture.
  const colorIdx = Math.max(showMin, Math.min(idx, showMax));
  const level = idx > showMax ? null : levels[colorIdx]; // coarser than l3 → no labels
  return { level, colorIdx, ...bbox };
}

async function fetchLabelFC(labelsBase, q, labelLimit, signal) {
  const u = new URL(labelsBase);
  u.searchParams.set("level", q.level);
  u.searchParams.set("minx", q.minx);
  u.searchParams.set("miny", q.miny);
  u.searchParams.set("maxx", q.maxx);
  u.searchParams.set("maxy", q.maxy);
  u.searchParams.set("limit", String(labelLimit));
  const res = await fetch(u, { signal });
  if (!res.ok) throw new Error(`labels ${res.status}`);
  return res.json();
}

// Tear down the current label set (stop its render timer, drop its SVG group).
// add_labels overwrites the renderer without doing this, so the old timer/group
// would otherwise leak and keep painting stale labels.
function clearLabels(sp) {
  const old = sp.secondary_renderers?.clusters;
  if (old) {
    try {
      old.stop();
      old.delete();
      delete sp.secondary_renderers.clusters;
    } catch {
      /* ignore */
    }
  }
}

// Replace the label set with a fresh one.
function applyLabels(sp, fc, labelFont) {
  clearLabels(sp);
  sp.add_labels(
    fc,
    "clusters",
    "label",
    "size",
    labelFont ? { font: labelFont } : {},
  );
  killLabelShadow(sp, "clusters");
}

// Predicate over a loaded point row from the active facet selections
// (state.filters: column -> Set of values). Each facet column is a ;-joined string
// (countries + the enriched facets); a point passes a facet if it carries any
// selected value (OR within a facet) and passes overall only if every active facet
// matches (AND across facets). No active facets -> everything passes.
function makeFilterPredicate() {
  const cols = Object.entries(state.filters);
  const splitMemo = new Map();
  return (row) => {
    for (const [col, wanted] of cols) {
      const v = row[col];
      if (!v) return false;
      const key = col + " " + v;
      let parts = splitMemo.get(key);
      if (!parts) {
        parts = v.split(";");
        splitMemo.set(key, parts);
      }
      let hit = false;
      for (let i = 0; i < parts.length; i++) {
        if (wanted.has(parts[i])) {
          hit = true;
          break;
        }
      }
      if (!hit) return false;
    }
    return true;
  };
}

// Cluster ids (at `levelField`) with at least one loaded point passing all active
// facets, so labels for fully-filtered-out clusters can be hidden. Returns null
// when no facet is active (caller skips label filtering). All facet columns live
// in the main tile, so this just scans loaded points.
function clustersPassingFilters(sp, levelField) {
  const cols = Object.keys(state.filters);
  if (cols.length === 0) return null;
  const present = new Set();
  const pred = makeFilterPredicate();
  const dt = sp.deeptable;
  const row = {};
  for (const tile of dt.map((t) => t)) {
    const rb = tile.record_batch;
    if (!rb) continue;
    const lc = rb.getChild(levelField);
    if (!lc) continue;
    const children = cols.map((c) => rb.getChild(c));
    const n = lc.length;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < cols.length; c++) {
        const child = children[c];
        row[cols[c]] = child ? child.get(i) : null;
      }
      if (pred(row)) present.add(String(lc.get(i)));
    }
  }
  return present;
}

// The active dynamic-label controller, so the country filter can ask labels to
// re-filter when the selection changes.
let activeLabels = null;

function setupDynamicLabels({
  sp,
  labelsBase,
  levels,
  extent,
  labelFont,
  clusterMax,
  clusterCount,
  labelLimit = LABEL_LIMIT,
}) {
  // Dedupe refetches against the data scale: skip if the layer and a coarsely
  // quantized bbox are unchanged, so tiny jitters don't spam the server.
  const bucket = Math.max(1e-9, Math.abs(extent.maxx - extent.minx) / 1024);
  const qkey = (q) =>
    `${q.level}|${Math.round(q.minx / bucket)}|${Math.round(q.miny / bucket)}|` +
    `${Math.round(q.maxx / bucket)}|${Math.round(q.maxy / bucket)}`;

  // Finest layer index whose cluster count fits deepscatter's categorical color
  // texture (COLOR_CATEGORY_LIMIT). Finer layers have more clusters and would
  // overflow it → black points, so coloring stops getting finer here (labels
  // still do). +1 leaves room for the noise (-1) category.
  const colorFloor = (() => {
    const top = Math.min(LABEL_LAYER_MAX, levels.length - 1);
    for (let i = 0; i <= top; i++) {
      if ((clusterCount[levels[i]] ?? Infinity) + 1 <= COLOR_CATEGORY_LIMIT)
        return i;
    }
    return top;
  })();

  // Point coloring follows the zoom layer just like labels, but never finer than
  // colorFloor. When the color layer changes, switch the encoding field + domain
  // (only repaints if coloring is on).
  const syncColor = (colorIdx) => {
    if (colorIdx == null) return;
    const colorLevel = levels[Math.max(colorFloor, colorIdx)];
    if (!colorLevel || colorLevel === state.colorField) return;
    state.colorField = colorLevel;
    state.maxClusterId = clusterMax[colorLevel] ?? 0;
    if (state.colorByClusters) applyColorEncoding(sp, state.clusterColors);
  };

  let timer = null;
  let ctrl = null;
  let lastKey = "";
  let appliedLevel = null;
  let destroyed = false;

  const run = async () => {
    if (destroyed || !sp.zoom) return;
    let q;
    try {
      q = computeLevelAndBbox(sp, levels, extent);
    } catch {
      return;
    }
    syncColor(q.colorIdx);
    if (!q.level) {
      // Zoomed out past the label window — show nothing.
      clearLabels(sp);
      appliedLevel = null;
      return;
    }
    const key = qkey(q);
    if (key === lastKey) return;
    lastKey = key;
    // On a layer change, drop the previous layer's labels immediately so they
    // don't linger while the new fetch is in flight. Same-layer pans keep their
    // labels until the refetch resolves, to avoid flicker.
    if (q.level !== appliedLevel) {
      clearLabels(sp);
      appliedLevel = null;
    }
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    try {
      const fc = await fetchLabelFC(labelsBase, q, labelLimit, ctrl.signal);
      if (destroyed) return;
      let features = fc.features ?? [];
      // Respect the active facet filters: only label clusters that still have a
      // visible (matching) point at this layer.
      const present = clustersPassingFilters(sp, q.level);
      if (present) {
        features = features.filter((f) =>
          present.has(String(f.properties?.cluster_id)),
        );
      }
      applyLabels(sp, { ...fc, features }, labelFont);
      appliedLevel = q.level;
    } catch (e) {
      if (e.name !== "AbortError") console.warn("label fetch failed", e);
    }
  };

  const schedule = () => {
    if (destroyed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, LABEL_DEBOUNCE_MS);
  };

  // Fires on every raw zoom/pan frame. The moment the layer changes, drop the old
  // layer's labels right away — don't wait for the debounced fetch — so a coarser
  // layer's labels never linger at a finer zoom (or vice-versa). The actual
  // fetch+apply for the new layer is still debounced via schedule().
  const onZoom = () => {
    if (destroyed) return;
    let q = null;
    try {
      q = computeLevelAndBbox(sp, levels, extent);
    } catch {
      /* scales not ready yet */
    }
    if (q) syncColor(q.colorIdx); // recolor immediately on a layer change
    const lvl = q ? q.level : null;
    // Clear on any layer change — including crossing out of the l0…l3 window
    // (lvl null), so coarse-zoom views show no stale labels.
    if (lvl !== appliedLevel) {
      clearLabels(sp);
      appliedLevel = null;
      lastKey = ""; // force the debounced run to refetch
    }
    schedule();
  };

  const api = {
    start() {
      try {
        sp.zoom?.zoomer?.on("zoom.seqoutlabels", onZoom);
      } catch {
        /* ignore */
      }
      activeLabels = api;
      run();
    },
    // Re-run the current fetch+filter (e.g. after the country filter changes).
    refresh() {
      if (destroyed) return;
      lastKey = "";
      run();
    },
    destroy() {
      destroyed = true;
      if (activeLabels === api) activeLabels = null;
      if (timer) clearTimeout(timer);
      if (ctrl) ctrl.abort();
      try {
        sp.zoom?.zoomer?.on("zoom.seqoutlabels", null);
      } catch {
        /* ignore */
      }
    },
  };
  return api;
}

export function setBackgroundColor(sp, backgroundColor) {
  sp.plotAPI({ duration: 0, background_color: backgroundColor });
  // deepscatter only paints its 2d background canvas at setup, so plotAPI alone
  // won't show until reload. Repaint it directly so theme switches are live.
  const bg = document.querySelector(
    "#container-for-canvas-2d-background canvas",
  );
  if (bg) {
    const ctx = bg.getContext("2d");
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, bg.width, bg.height);
  }
  // Re-theme the labels and force a redraw (they only repaint on zoom ticks).
  labelColor = labelColorFor(backgroundColor);
  try {
    sp.secondary_renderers?.clusters?.render();
  } catch {
    /* not ready yet */
  }
  // Keep noise points faded into the new background; repaint if coloring is on.
  if (state.clusterColors.length) {
    state.clusterColors[0] = noiseColorFor(backgroundColor);
    if (state.colorByClusters) applyColorEncoding(sp, state.clusterColors);
  }
}

/** Resolve the accession for a clicked datum (may require a tile transform). */
export async function resolveAccession(sp, datum) {
  let accession = datum.accession;
  if (!accession) {
    const r = await sp.deeptable.applyTransformationToPoint(
      "accession",
      datum.ix,
    );
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

  const selection = await dt.select_data({
    name,
    ids: [accessionId],
    idField: "accession",
  });
  await selection.applyToAllTiles();

  let found = null;
  for (const point of selection) {
    found = { x: point.x, y: point.y, accession: point.accession };
    break;
  }

  if (!found) {
    delete dt.transformations[name];
    if (state.currentSearchName === name) state.currentSearchName = null;
    return null;
  }

  if (found) {
    await sp.plotAPI({
      duration: 300,
      encoding: { foreground: { field: name, op: "eq", a: 1 } },
      background_options: {
        color: DEFAULT_BG_COLOR,
        opacity: DEFAULT_BG_OPACITY,
        size: DEFAULT_BG_SIZE,
      },
    });
    const extent = state.mapExtent;
    const extentWidth = extent
      ? Math.abs(extent.maxx - extent.minx)
      : Math.abs(
          sp.zoom.current_corners().x[1] - sp.zoom.current_corners().x[0],
        );
    const extentHeight = extent
      ? Math.abs(extent.maxy - extent.miny)
      : Math.abs(
          sp.zoom.current_corners().y[1] - sp.zoom.current_corners().y[0],
        );
    const halfWidth = Math.max(extentWidth * SEARCH_VIEW_FRACTION * 0.5, 1e-6);
    const halfHeight = Math.max(
      extentHeight * SEARCH_VIEW_FRACTION * 0.5,
      1e-6,
    );
    sp.zoom.zoom_to_bbox(
      {
        x: [found.x - halfWidth, found.x + halfWidth],
        y: [found.y - halfHeight, found.y + halfHeight],
      },
      500,
      1,
    );
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
// Facet filters (multi-select, multi-column): HIDE points that don't match every
// active facet (countries + enriched), via deepscatter's single `filter` slot.
// Independent of color (clusters) and foreground (lasso/search), so cluster
// coloring still applies to the visible points.
//
// `selections` is { column: string[] }; only columns with a non-empty list are
// active. Replaces the previous country-only filter — countries is now just one
// of the facet columns.
// ---------------------------------------------------------------------------
export async function applyFilters(sp, selections) {
  const dt = sp.deeptable;
  const old = state.filterName;
  const active = Object.entries(selections ?? {}).filter(
    ([, vals]) => vals && vals.length,
  );
  state.filters = Object.fromEntries(active.map(([k, v]) => [k, new Set(v)]));

  if (active.length === 0) {
    state.filterName = null;
    sp.plotAPI({ duration: 0, encoding: { filter: null } });
    if (old) delete dt.transformations[old];
  } else {
    const name = "ff_" + Date.now();
    state.filterName = name;
    const pred = makeFilterPredicate();
    await applyTransformation(sp, name, (row) => (pred(row) ? 1 : 0));
    sp.plotAPI({
      duration: 0,
      encoding: { filter: { field: name, op: "gt", a: 0 } },
    });
    if (old) delete dt.transformations[old];
  }

  // Keep an active lasso selection (highlight + stats) in sync with the filter.
  await reapplyLassoForFilters(sp);
  // Re-filter labels so only clusters with visible (matching) points show.
  activeLabels?.refresh?.();
}

export function setColorByClusters(sp, value, clusterColors) {
  state.colorByClusters = value;
  applyColorEncoding(sp, clusterColors);
}

// ---------------------------------------------------------------------------
// Lasso
// ---------------------------------------------------------------------------
export function screenToData(sp, screenX, screenY) {
  try {
    const scales = sp.zoom.scales();
    if (scales)
      return { x: scales.x_.invert(screenX), y: scales.y_.invert(screenY) };
  } catch (err) {
    console.warn("screenToData failed:", err);
  }
  return { x: screenX, y: screenY };
}

// Lasso membership: inside the polygon AND passing every active facet filter — so
// the selection/stats respect the sidebar filters.
function lassoSelector(dataVerts) {
  const pred = makeFilterPredicate();
  return (row) =>
    pointInPolygon(row.x, row.y, dataVerts) && pred(row) ? 1 : 0;
}

export async function performLasso(sp, dataVerts) {
  state.lassoDataVerts = dataVerts;

  const dt = sp.deeptable;
  if (state.currentLassoName) delete dt.transformations[state.currentLassoName];

  const name = "ls_" + Date.now();
  state.currentLassoName = name;

  await applyTransformation(sp, name, lassoSelector(dataVerts));
  sp.plotAPI({
    duration: 0,
    encoding: { foreground: { field: name, op: "eq", a: 1 } },
    background_options: {
      color: LASSO_BG_COLOR,
      opacity: LASSO_DIM_OPACITY,
      size: LASSO_DIM_SIZE,
    },
  });
}

// Recompute the active lasso selection against the current facet filters (called
// when a filter changes while a lasso is active).
async function reapplyLassoForFilters(sp) {
  if (!state.currentLassoName || !state.lassoDataVerts.length) return;
  await applyTransformation(
    sp,
    state.currentLassoName,
    lassoSelector(state.lassoDataVerts),
  );
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

export function hasLassoSelection() {
  return state.currentLassoName !== null;
}

// Top-N [value, count] entries from a counts object, collapsing the tail into
// one "Other" bucket so the bar charts stay short.
function topEntries(counts, n = 5) {
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, n);
  const other = sorted.slice(n).reduce((s, [, c]) => s + c, 0);
  if (other > 0) top.push(["Other", other]);
  return top;
}

// Tally the lasso selection straight from the loaded tile columns: accessions
// (for download), country distribution, and one distribution per enriched facet
// (organism/tissue/disease/…). All columns are force-loaded with every tile, so
// no network round-trip is needed — the stats render instantly.
export async function collectLassoData(sp) {
  const selectionName = state.currentLassoName;
  const facetColumns = state.facetColumns ?? [];
  const dt = sp.deeptable;
  const accessions = [];
  const countryCounts = {};
  const facetCounts = Object.fromEntries(facetColumns.map((c) => [c, {}]));

  const tally = (counts, value) => {
    if (!value) return;
    for (const part of value.split(";")) {
      if (part) counts[part] = (counts[part] || 0) + 1;
    }
  };

  for (const tile of dt.map((t) => t)) {
    if (!tile.record_batch || !tile.hasLoadedColumn(selectionName)) continue;

    const rb = tile.record_batch;
    const col = rb.getChild(selectionName);
    const accCol = rb.getChild("accession");
    const countriesCol = rb.getChild("countries");
    const facetCols = facetColumns.map((c) => rb.getChild(c));
    if (!col || !accCol) continue;

    for (let i = 0; i < col.length; i++) {
      if (col.get(i) < 0.5) continue;
      const acc = accCol.get(i);
      if (acc) accessions.push(acc);
      if (countriesCol) tally(countryCounts, countriesCol.get(i));
      for (let k = 0; k < facetCols.length; k++) {
        if (facetCols[k])
          tally(facetCounts[facetColumns[k]], facetCols[k].get(i));
      }
    }
  }

  const facets = Object.fromEntries(
    facetColumns.map((c) => [c, topEntries(facetCounts[c])]),
  );

  return {
    accessions,
    countryCount: Object.keys(countryCounts).length,
    topCountries: topEntries(countryCounts),
    facets,
  };
}
