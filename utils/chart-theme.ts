/**
 * Theme constants for chart/map libraries (ApexCharts, deck.gl, Leaflet,
 * 3d-force-graph) that consume plain JS strings instead of CSS variables.
 */

// ApexCharts — growth, source distribution, organism growth

export type ApexChartTheme = {
  background: string;
  foreColor: string;
  titleColor: string;
  subtitleColor: string;
  legendLabelColor: string;
  dataLabelColor: string;
  gridBorderColor: string;
};

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

// 8-color palette for multi-series charts. Ordered for adjacent-color
// contrast under deuteranopia/protanopia. Reads on both themes.
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

// Global contributions map — canvas compositing + panel + overlay text

export type MapCanvasTheme = {
  background: string;
  title: string;
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

export const MAP_ATTRIBUTION_COLOR = "#999999" as const;

export function getMapPanelBackground(isDark: boolean): string {
  return isDark ? "#000000" : "#f0f0f0";
}

export function getMapMutedTextColor(isDark: boolean): string {
  return isDark ? "#6b7280" : "#9ca3af";
}

// Leaflet popup — submitting-org-map.tsx

export type LeafletPopupTheme = {
  link: string;
  markerFill: string;
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

// 3d-force-graph — similar-projects-graph.tsx
// Not theme-gated; the graph runs on its own dark canvas.
export const SIMILARITY_GRAPH_COLORS = {
  link: "#9ca3af",
  center: "#d97706",
  geo: "#2563eb",
  sra: "#8b4513",
  arrayexpress: "#eab308",
} as const;
