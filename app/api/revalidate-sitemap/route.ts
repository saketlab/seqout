import { revalidatePath } from "next/cache";

// POST /api/revalidate-sitemap — purges the cached sitemap index and chunk pages.
export async function POST() {
  revalidatePath("/sitemap.xml");
  revalidatePath("/sitemap/[id]", "page");
  return Response.json({ revalidated: true });
}
