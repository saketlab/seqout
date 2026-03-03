import { ImageResponse } from "next/og";

const API_BASE_URL =
  process.env.PYSRAWEB_API_BASE ?? "https://seqout.org/api";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ q?: string; db?: string }>;
};

export default async function OpengraphImage({ searchParams }: Props) {
  const { q, db } = await searchParams;
  const query = q ?? "";

  let total: number | null = null;
  if (query) {
    try {
      let url = `${API_BASE_URL}/search?q=${encodeURIComponent(query)}`;
      if (db === "sra" || db === "geo" || db === "arrayexpress") {
        url += `&db=${encodeURIComponent(db)}`;
      }
      const res = await fetch(url, { next: { revalidate: 60 } });
      if (res.ok) {
        const data = await res.json();
        total = data.total ?? null;
      }
    } catch {
      // fall through
    }
  }

  const subtitle = !query
    ? "Search GEO, SRA, ENA & ArrayExpress sequencing datasets"
    : total !== null
      ? `${total.toLocaleString()} result${total === 1 ? "" : "s"} found`
      : "Search results";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 70px",
          color: "#ffffff",
          background:
            "linear-gradient(135deg, #0c4a6e 0%, #0f172a 50%, #1e293b 100%)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-100px",
            right: "-100px",
            width: "400px",
            height: "400px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, #0ea5e9 0%, transparent 70%)",
            opacity: 0.3,
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              padding: "14px 28px",
              borderRadius: "12px",
              fontSize: 32,
              fontWeight: 700,
              backgroundColor: "#0ea5e9",
              color: "#ffffff",
              boxShadow: "0 4px 20px #0ea5e940",
            }}
          >
            Search
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 600,
              color: "#94a3b8",
              display: "flex",
            }}
          >
            seqout
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            width: "100%",
            zIndex: 1,
          }}
        >
          {query ? (
            <div
              style={{
                fontSize: 64,
                lineHeight: 1.15,
                fontWeight: 800,
                letterSpacing: "-0.025em",
                color: "#ffffff",
                textShadow: "0 2px 10px rgba(0, 0, 0, 0.3)",
                display: "flex",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {query.length > 60 ? query.slice(0, 60) + "..." : query}
            </div>
          ) : (
            <div
              style={{
                fontSize: 52,
                lineHeight: 1.15,
                fontWeight: 800,
                color: "#ffffff",
                display: "flex",
              }}
            >
              Search datasets
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                fontSize: 40,
                fontWeight: 700,
                color: "#7dd3fc",
                display: "flex",
              }}
            >
              {subtitle}
            </div>
          </div>

          <div
            style={{
              fontSize: 24,
              fontWeight: 500,
              color: "#cbd5e1",
              marginTop: 8,
              display: "flex",
            }}
          >
            Explore sequencing datasets across GEO, SRA, ENA &
            ArrayExpress
          </div>
        </div>
      </div>
    ),
    size,
  );
}
