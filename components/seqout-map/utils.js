// Ported verbatim from saketlab-experiments/js/utils.js
import { state } from "./state.js";
import { DEFAULT_BG_OPACITY, DEFAULT_BG_SIZE, DEFAULT_BG_COLOR } from "./constants.js";

// Cluster columns arrive dictionary-encoded. deepscatter's categorical color
// texture holds only 4,096 entries, but the finer Leiden levels contain far more
// clusters. The engine creates a numeric transform for each layer, allowing the
// GPU's continuous color texture to cover every advertised clustering level.
export function clusterColorEncoding() {
  return {
    field: state.colorValueField,
    domain: [0, Math.max(1, state.maxClusterId + 1)],
    range: "Turbo",
  };
}

// Archive coloring: only ~7 sources, so (unlike the fine cluster layers) they fit
// deepscatter's categorical color texture. `source` is a baked dictionary column,
// so color it directly with an ordinal scale — domain = the archive strings, range
// = their parallel hex colors — giving each archive a fixed color.
export function sourceColorEncoding() {
  return {
    field: "source",
    domain: state.sourceDomain ?? [],
    range: state.sourceRange ?? ["#4CAF50"],
  };
}

export function pointInPolygon(px, py, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x, yi = verts[i].y;
    const xj = verts[j].x, yj = verts[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export async function applyTransformation(sp, name, fn, prerequisites = []) {
  const dt = sp.deeptable;
  // Sidecar columns (including cluster layers) are fetched lazily by
  // deepscatter. Declare the source fields so a filter works even before that
  // field has been used for a color encoding.
  dt.register_transformation(name, fn, prerequisites);
  await Promise.all(
    dt.map((t) => t.apply_transformation(name).catch(() => { }))
  );
}

// Foreground is owned by search/lasso (a dim highlight). The country filter is a
// separate `filter` slot (hide), and color is owned by the cluster toggle — both
// are left untouched here so they persist.
export function restoreForeground(sp) {
  let encoding = { foreground: null };

  if (state.currentSearchName) {
    encoding = { foreground: { field: state.currentSearchName, op: "eq", a: 1 } };
  } else if (state.currentLassoName) {
    encoding = { foreground: { field: state.currentLassoName, op: "eq", a: 1 } };
  }

  sp.plotAPI({
    duration: 0,
    encoding,
    background_options: {
      color: DEFAULT_BG_COLOR,
      opacity: DEFAULT_BG_OPACITY,
      size: DEFAULT_BG_SIZE,
    },
  });
}

export function applyColorEncoding(sp) {
  const encoding = {};

  if (state.currentSearchName) {
    encoding.foreground = { field: state.currentSearchName, op: "eq", a: 1 };
  } else if (state.currentLassoName) {
    encoding.foreground = { field: state.currentLassoName, op: "eq", a: 1 };
  } else {
    encoding.foreground = null;
  }

  if (state.colorBySource && state.sourceRange) {
    encoding.color = sourceColorEncoding();
  } else if (state.colorByClusters && state.colorField) {
    encoding.color = clusterColorEncoding();
  } else {
    encoding.color = { constant: "#4CAF50" };
  }

  sp.plotAPI({ encoding });
}
