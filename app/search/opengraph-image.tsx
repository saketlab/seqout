import {
  ARCHIVE_LIST_TEXT,
  OG,
  ogBackground,
  ogGlow,
} from "@/utils/constants";
import { SEARCH_DBS, type SearchDb } from "@/utils/db-colors";
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
      if (SEARCH_DBS.includes(db as SearchDb)) {
        url += `&db=${encodeURIComponent(db!)}`;
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
    ? `Search ${ARCHIVE_LIST_TEXT} datasets`
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
          color: OG.dark.fg,
          background: ogBackground(OG.dark.search.secondary),
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
            background: ogGlow(OG.dark.search.primary),
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
              backgroundColor: OG.dark.search.primary,
              color: OG.dark.fg,
              boxShadow: `0 4px 20px ${OG.dark.search.primary}40`,
            }}
          >
            Search
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 600,
              color: OG.dark.muted,
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
                color: OG.dark.fg,
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
                color: OG.dark.fg,
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
                color: OG.dark.search.accent,
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
              color: OG.dark.subtle,
              marginTop: 8,
              display: "flex",
            }}
          >
            Explore sequencing datasets across {ARCHIVE_LIST_TEXT}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
