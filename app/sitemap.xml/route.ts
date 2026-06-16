import {
  API_BASE,
  LIMIT,
  SITE_URL,
  SITEMAP_SOURCES,
  xmlResponse,
} from "../sitemap/_utils";

export const revalidate = 2592000;

export async function GET() {
  const res = await fetch(`${API_BASE}/sitemap/counts`, {
    next: { revalidate: 2592000 },
  });
  if (!res.ok) {
    return new Response("Failed to fetch sitemap counts", { status: 502 });
  }

  const counts = (await res.json()) as Record<string, number>;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  xml += `  <sitemap><loc>${SITE_URL}/sitemap/static.xml</loc></sitemap>\n`;

  for (const { key } of SITEMAP_SOURCES) {
    const chunks = Math.ceil((counts[key] ?? 0) / LIMIT);
    for (let i = 0; i < chunks; i++) {
      xml += `  <sitemap><loc>${SITE_URL}/sitemap/${key}-${i}.xml</loc></sitemap>\n`;
    }
  }

  xml += `</sitemapindex>\n`;

  return xmlResponse(xml);
}
