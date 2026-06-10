// Ported verbatim from saketlab-experiments/js/utils.js
import { state } from "./state.js";
import { DEFAULT_BG_OPACITY, DEFAULT_BG_SIZE, DEFAULT_BG_COLOR } from "./constants.js";

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

export function restoreForeground(sp) {
  let encoding = { foreground: null };
  let colorEncoding = null;

  if (state.currentFilterName) {
    encoding = { foreground: { field: state.currentFilterName, op: "gt", a: 0 } };
    if (state.colorByClusters) {
      colorEncoding = {
        field: "cluster_id",
        range: state.clusterColors,
        domain: [1, state.numClusters],
      };
    } else if (state.countryFilterData && state.countryFilterData.colors.length > 0) {
      colorEncoding = {
        field: state.currentFilterName,
        range: state.countryFilterData.colors,
        domain: [0, state.countryFilterData.selectedCountries.length],
      };
    }
  } else if (state.currentSearchName) {
    encoding = { foreground: { field: state.currentSearchName, op: "eq", a: 1 } };
  } else if (state.currentLassoName) {
    encoding = { foreground: { field: state.currentLassoName, op: "eq", a: 1 } };
  }

  sp.plotAPI({
    duration: 0,
    encoding: {
      ...encoding,
      ...(colorEncoding ? { color: colorEncoding } : {}),
    },
    background_options: {
      color: DEFAULT_BG_COLOR,
      opacity: DEFAULT_BG_OPACITY,
      size: DEFAULT_BG_SIZE,
    },
  });
}

export function applyColorEncoding(sp, clusterColors, clusters) {
  const encoding = {};

  if (state.currentFilterName) {
    // keep country filter's foreground, only change color
  } else if (state.currentLassoName) {
    encoding.foreground = { field: state.currentLassoName, op: "eq", a: 1 };
  } else {
    encoding.foreground = null;
  }

  if (state.colorByClusters) {
    encoding.color = {
      field: "cluster_id",
      range: clusterColors,
      domain: [1, clusters.length],
    };
  } else if (state.currentFilterName && state.countryFilterData.colors.length > 0) {
    encoding.color = {
      field: state.currentFilterName,
      range: state.countryFilterData.colors,
      domain: [0, state.countryFilterData.selectedCountries.length],
    };
  } else {
    encoding.color = { constant: "#4CAF50" };
  }

  sp.plotAPI({ encoding });
}
