import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "seqout - Search GEO, SRA, ENA & ArrayExpress Datasets",
    short_name: "seqout",
    description:
      "Fast exploration of GEO, SRA, ENA & ArrayExpress sequencing datasets with unified metadata views.",
    start_url: "/",
    display: "standalone",
    background_color: "#0e1015",
    theme_color: "#0e1015",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
