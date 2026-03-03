import { SERVER_URL, SITE_URL } from "@/utils/constants";

const STATIC_PATHS = ["/", "/faq", "/map", "/mcp", "/stats", "/search"];

function xmlResponse(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=2592000",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const slug = id.replace(/\.xml$/, "");

  if (slug === "static") {
    return buildStaticSitemap();
  }

  const page = parseInt(slug, 10);
  if (isNaN(page) || page < 0) {
    return new Response("Not found", { status: 404 });
  }

  return buildAccessionSitemap(page);
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

async function buildAccessionSitemap(page: number) {
  const res = await fetch(
    `${SERVER_URL}/sitemap/accessions?page=${page}&limit=50000`,
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
    xml += `  <url><loc>${SITE_URL}/p/${encodeURIComponent(acc)}</loc></url>\n`;
  }

  xml += `</urlset>\n`;

  return xmlResponse(xml);
}
