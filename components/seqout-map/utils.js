// Ported verbatim from saketlab-experiments/js/utils.js
import { state } from "./state.js";
import { DEFAULT_BG_OPACITY, DEFAULT_BG_SIZE, DEFAULT_BG_COLOR } from "./constants.js";

// Categorical color encoding for the current cluster layer. The layer column is
// dictionary-encoded, so deepscatter assigns distinct colors per cluster via an
// ordinal scale over this domain: "-1" (noise) → range[0] (grey), cluster id i →
// range[i+1]. The domain values are strings to match the dictionary values.
export function clusterColorEncoding(colors) {
  const domain = ["-1"];
  for (let i = 0; i <= state.maxClusterId; i++) domain.push(String(i));
  return { field: state.colorField, range: colors, domain };
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

export async function applyTransformation(sp, name, fn) {
  const dt = sp.deeptable;
  dt.register_transformation(name, fn);
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

export function applyColorEncoding(sp, clusterColors) {
  const encoding = {};

  if (state.currentSearchName) {
    encoding.foreground = { field: state.currentSearchName, op: "eq", a: 1 };
  } else if (state.currentLassoName) {
    encoding.foreground = { field: state.currentLassoName, op: "eq", a: 1 };
  } else {
    encoding.foreground = null;
  }

  encoding.color =
    state.colorByClusters && state.colorField
      ? clusterColorEncoding(clusterColors)
      : { constant: "#4CAF50" };

  sp.plotAPI({ encoding });
}
