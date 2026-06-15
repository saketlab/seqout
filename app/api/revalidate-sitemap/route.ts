import { revalidatePath } from "next/cache";

// POST /api/revalidate-sitemap?secret=... — purges the cached sitemap index and
// all chunk pages so newly-added datasets show up on next fetch.
export async function POST(request: Request) {
  const secret = process.env.SITEMAP_REVALIDATE_SECRET;
  if (!secret) {
    return Response.json(
      { error: "SITEMAP_REVALIDATE_SECRET not configured" },
      { status: 500 },
    );
  }
  if (new URL(request.url).searchParams.get("secret") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  revalidatePath("/sitemap.xml");
  revalidatePath("/sitemap/[id]", "page");
  return Response.json({ revalidated: true });
}
