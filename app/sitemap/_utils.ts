import { SITE_URL } from "@/utils/constants";

export { SITE_URL };

export { SERVER_API_BASE as API_BASE } from "@/utils/constants";
export const LIMIT = 50_000;

export const SITEMAP_SOURCES: { key: string; path: string }[] = [
  { key: "geo", path: "/p" },
  { key: "sra", path: "/p" },
  { key: "arrayexpress", path: "/p" },
  { key: "ena", path: "/p" },
  { key: "gsa", path: "/p" },
  // *_exp (/e) and run (/r) sources are omitted while those pages are noindex.
  { key: "geo_sample", path: "/s" },
  { key: "sra_sample", path: "/s" },
  { key: "ena_sample", path: "/s" },
  { key: "gsa_sample", path: "/s" },
];

export const SOURCE_PATHS = new Map(
  SITEMAP_SOURCES.map((s) => [s.key, s.path]),
);

export function xmlResponse(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=2592000",
    },
  });
}
