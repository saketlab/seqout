import {
  API_BASE,
  LIMIT,
  SITE_URL,
  SOURCE_PATHS,
  xmlResponse,
} from "../_utils";

export const revalidate = 2592000;

const STATIC_PATHS = [
  "/",
  "/faq",
  "/map",
  "/mcp",
  "/stats",
  "/api-docs",
  "/authors",
];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const slug = id.replace(/\.xml$/, "");

  if (slug === "static") {
    return buildStaticSitemap();
  }

  const match = slug.match(/^(.+)-(\d+)$/);
  const prefix = match ? SOURCE_PATHS.get(match[1]) : undefined;
  if (!match || !prefix) {
    return new Response("Not found", { status: 404 });
  }

  return buildAccessionSitemap(match[1], parseInt(match[2], 10), prefix);
}

function buildStaticSitemap() {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  for (const path of STATIC_PATHS) {
    xml += `  <url><loc>${SITE_URL}${path}</loc></url>\n`;
  }

  xml += `</urlset>\n`;

  return xmlResponse(xml);
}

async function buildAccessionSitemap(
  source: string,
  page: number,
  prefix: string,
) {
  const res = await fetch(
    `${API_BASE}/sitemap/accessions?source=${source}&page=${page}&limit=${LIMIT}`,
    { next: { revalidate: 2592000 } },
  );
  if (!res.ok) {
    return new Response("Failed to fetch accessions", { status: 502 });
  }

  const { accessions } = (await res.json()) as { accessions: string[] };

  if (accessions.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  for (const acc of accessions) {
    xml += `  <url><loc>${SITE_URL}${prefix}/${encodeURIComponent(acc)}</loc></url>\n`;
  }

  xml += `</urlset>\n`;

  return xmlResponse(xml);
}
