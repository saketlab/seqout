import {
  API_BASE,
  LIMIT,
  SITE_URL,
  SITEMAP_SOURCES,
  xmlResponse,
} from "../sitemap/_utils";

export const revalidate = 2592000;

const SOURCE_DATE_KEY: Record<string, string> = {
  geo: "geo",
  geo_sample: "geo",
  sra: "sra",
  sra_exp: "sra",
  sra_sample: "sra",
  run: "sra",
  ena: "ena",
  ena_exp: "ena",
  ena_sample: "ena",
  arrayexpress: "arrayexpress",
};

type LastUpdated = {
  last_updated: string | null;
  by_source?: Record<string, string | null>;
};

async function fetchLastUpdated(): Promise<LastUpdated | null> {
  try {
    const res = await fetch(`${API_BASE}/stats/last-updated`, {
      next: { revalidate: 2592000 },
    });
    if (!res.ok) return null;
    return (await res.json()) as LastUpdated;
  } catch {
    return null;
  }
}

export async function GET() {
  const [countsRes, lastUpdated] = await Promise.all([
    fetch(`${API_BASE}/sitemap/counts`, { next: { revalidate: 2592000 } }),
    fetchLastUpdated(),
  ]);
  if (!countsRes.ok) {
    return new Response("Failed to fetch sitemap counts", { status: 502 });
  }

  const counts = (await countsRes.json()) as Record<string, number>;

  const dateOnly = (iso: string | null | undefined) =>
    iso ? iso.split("T")[0] : null;
  const overall = dateOnly(lastUpdated?.last_updated);
  const lastmodTag = (key: string) => {
    const src = SOURCE_DATE_KEY[key];
    const d = (src ? dateOnly(lastUpdated?.by_source?.[src]) : null) ?? overall;
    return d ? `<lastmod>${d}</lastmod>` : "";
  };

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  const staticLastmod = overall ? `<lastmod>${overall}</lastmod>` : "";
  xml += `  <sitemap><loc>${SITE_URL}/sitemap/static.xml</loc>${staticLastmod}</sitemap>\n`;

  for (const { key } of SITEMAP_SOURCES) {
    const chunks = Math.ceil((counts[key] ?? 0) / LIMIT);
    const lastmod = lastmodTag(key);
    for (let i = 0; i < chunks; i++) {
      xml += `  <sitemap><loc>${SITE_URL}/sitemap/${key}-${i}.xml</loc>${lastmod}</sitemap>\n`;
    }
  }

  xml += `</sitemapindex>\n`;

  return xmlResponse(xml);
}
