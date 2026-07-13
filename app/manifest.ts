import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "seqout",
    short_name: "seqout",
    description:
      "Fast exploration of GEO, SRA, ENA, DDBJ, GSA & ArrayExpress datasets with unified metadata.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    background_color: "#0e1015",
    theme_color: "#0e1015",
    orientation: "any",
    lang: "en",
    categories: ["science", "education", "productivity"],
    prefer_related_applications: false,
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Search datasets",
        short_name: "Search",
        description: "Search GEO, SRA, ENA, DDBJ, GSA, and ArrayExpress metadata.",
        url: "/search",
      },
      {
        name: "Open map",
        short_name: "Map",
        description: "Explore the seqout dataset map.",
        url: "/map",
      },
    ],
  };
}
