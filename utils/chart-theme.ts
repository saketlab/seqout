/**
 * Central chart/map theme constants.
 *
 * Background: these values can't use Radix CSS variables directly because
 * they run inside JS engines — ApexCharts config objects, deck.gl layer
 * options, Leaflet popup HTML strings, 3d-force-graph node callbacks, and
 * Canvas 2D compositing. Each of those consumes plain JS strings, not
 * `var(--gray-11)`-style references.
 *
 * This file is the single source of truth for every theme-aware chart/map
 * color that doesn't already live in `utils/db-colors.ts` (which holds the
 * load-bearing brand colors for GEO/SRA/ArrayExpress/ENA).
 *
 * Every export is theme-aware via an `isDark: boolean` parameter. Call
 * these from inside components with:
 *
 *   const { resolvedTheme } = useTheme();
 *   const isDark = resolvedTheme === "dark";
 *   const chart = getApexChartTheme(isDark);
 *
 * When a future brand update changes the neutral ramp or adds a new chart
 * token, there is exactly one file to edit.
 */

// ---------------------------------------------------------------------------
// ApexCharts — growth, source distribution, organism growth
// ---------------------------------------------------------------------------

export type ApexChartTheme = {
  /** Chart canvas background. */
  background: string;
  /** Default foreground (axis labels, tooltips). */
  foreColor: string;
  /** Chart title text color. */
  titleColor: string;
  /** Chart subtitle text color. */
  subtitleColor: string;
  /** Legend entry label color. */
  legendLabelColor: string;
  /** Data label color on bars/points. */
  dataLabelColor: string;
  /** Grid line / border color. */
  gridBorderColor: string;
};

/**
 * ApexCharts theme values derived from Radix's neutral gray ramp. Mirror
 * what the rest of the UI uses so charts visually align with prose.
 */
export function getApexChartTheme(isDark: boolean): ApexChartTheme {
  return isDark
    ? {
        background: "#111113",
        foreColor: "#a1a1aa",
        titleColor: "#fafafa",
        subtitleColor: "#a1a1aa",
        legendLabelColor: "#d4d4d8",
        dataLabelColor: "#e4e4e7",
        gridBorderColor: "#3f3f46",
      }
    : {
        background: "#ffffff",
        foreColor: "#71717a",
        titleColor: "#000000",
        subtitleColor: "#555555",
        legendLabelColor: "#3f3f46",
        dataLabelColor: "#18181b",
        gridBorderColor: "#e4e4e7",
      };
}

// ---------------------------------------------------------------------------
// Multi-series chart palette (platform comparison, stacked bar breakdowns)
// ---------------------------------------------------------------------------

/**
 * 8-color palette for multi-series charts where each series is a distinct
 * category (platform comparison, organism groups, etc.). Ordered to
 * maximize adjacent-color contrast so the first few picks are always
 * distinguishable even under deuteranopia/protanopia.
 *
 * NOT theme-gated — these colors have enough saturation to read on both
 * the light and dark chart backgrounds.
 */
export const CHART_SERIES_PALETTE: readonly string[] = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
] as const;

// ---------------------------------------------------------------------------
// Global contributions map — canvas compositing + panel + overlay text
// ---------------------------------------------------------------------------

export type MapCanvasTheme = {
  /** Canvas background when exporting the composite map image. */
  background: string;
  /** Title text color drawn onto the exported canvas. */
  title: string;
  /** Attribution / "Source: seqout.org" footer color. Same on both themes. */
  attribution: string;
};

export function getMapCanvasTheme(isDark: boolean): MapCanvasTheme {
  return isDark
    ? {
        background: "#0d1117",
        title: "#e6edf3",
        attribution: MAP_ATTRIBUTION_COLOR,
      }
    : {
        background: "#ffffff",
        title: "#1c2024",
        attribution: MAP_ATTRIBUTION_COLOR,
      };
}

/** Theme-agnostic muted gray for chart/map attribution text (SVG + Canvas). */
export const MAP_ATTRIBUTION_COLOR = "#999999" as const;

/** Filter panel background behind the deck.gl map. */
export function getMapPanelBackground(isDark: boolean): string {
  return isDark ? "#000000" : "#f0f0f0";
}

/** Muted text on the map overlay (country labels, legend hints). */
export function getMapMutedTextColor(isDark: boolean): string {
  return isDark ? "#6b7280" : "#9ca3af";
}

// ---------------------------------------------------------------------------
// Leaflet popup — submitting-org-map.tsx
// ---------------------------------------------------------------------------

export type LeafletPopupTheme = {
  /** Organization link color inside the popup HTML. */
  link: string;
  /** Marker fill color. */
  markerFill: string;
  /** Marker border / ring color. */
  markerBorder: string;
};

export function getLeafletPopupTheme(isDark: boolean): LeafletPopupTheme {
  return isDark
    ? {
        link: "#63b3ed",
        markerFill: "#e05252",
        markerBorder: "#ffffff",
      }
    : {
        link: "#2b6cb0",
        markerFill: "#d63031",
        markerBorder: "#2d3436",
      };
}

// ---------------------------------------------------------------------------
// 3d-force-graph — similar-projects-graph.tsx
// ---------------------------------------------------------------------------

/**
 * 3d-force-graph node + link colors. Not theme-gated because the graph
 * runs in its own dark canvas and the colors are chosen to work on it.
 *
 *   link:   neutral gray for the connecting lines
 *   center: warm amber for the project the user is viewing
 *   geo:    blue for GEO source nodes
 *   sra:    saddle brown for SRA source nodes (distinct from GEO)
 */
export const SIMILARITY_GRAPH_COLORS = {
  link: "#9ca3af",
  center: "#d97706",
  geo: "#2563eb",
  sra: "#8b4513",
} as const;
