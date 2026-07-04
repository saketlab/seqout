import { revalidatePath } from "next/cache";

export async function POST(request: Request) {
  const secret = process.env.SITEMAP_REVALIDATE_SECRET;
  if (secret) {
    const provided =
      new URL(request.url).searchParams.get("secret") ??
      request.headers.get("x-revalidate-secret");
    if (provided !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  revalidatePath("/sitemap.xml");
  revalidatePath("/sitemap/[id]", "page");
  return Response.json({ revalidated: true });
}
