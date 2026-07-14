import { OG, SERVER_API_BASE, ogBackground, ogGlow } from "@/utils/constants";
import { DB_COLOR_MAP, type DbSource } from "@/utils/db-colors";
import { ImageResponse } from "next/og";

type ProjectKind = DbSource;

type ProjectPayload = {
  title?: string | null;
};

export const projectOgSize = {
  width: 1200,
  height: 630,
};

export const projectOgContentType = "image/png";

const labelByKind: Record<ProjectKind, string> = {
  geo: "GEO",
  sra: "SRA",
  ena: "ENA",
  arrayexpress: "ArrayExpress",
  gsa: "GSA",
  dra: "DRA",
  gea: "GEA",
};

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function truncateOgTitle(title: string, maxChars = 88): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trimEnd()}...`;
}

async function fetchProjectTitle(accession: string): Promise<string> {
  try {
    const response = await fetch(
      `${SERVER_API_BASE}/project/${encodeURIComponent(accession)}`,
      {
        next: { revalidate: 3600 },
      },
    );

    if (!response.ok) {
      return accession;
    }

    const payload = (await response.json()) as ProjectPayload;
    const title = payload.title?.trim();
    return title ? decodeHtmlEntities(title) : accession;
  } catch {
    return accession;
  }
}

export async function fetchProjectSocialTitle(accession: string) {
  return fetchProjectTitle(accession);
}

export async function generateProjectOgImage(
  accession: string,
  kind: ProjectKind,
) {
  const title = truncateOgTitle(await fetchProjectTitle(accession));
  const sourceLabel = labelByKind[kind];
  const colors = DB_COLOR_MAP[kind].og;

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
          background: ogBackground(colors.secondary),
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
            background: ogGlow(colors.primary),
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
              backgroundColor: colors.primary,
              color: OG.dark.fg,
              boxShadow: `0 4px 20px ${colors.primary}40`,
            }}
          >
            {sourceLabel}
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
          <div
            style={{
              fontSize: 64,
              lineHeight: 1.15,
              fontWeight: 800,
              letterSpacing: "-0.025em",
              color: OG.dark.fg,
              textShadow: "0 2px 10px rgba(0, 0, 0, 0.3)",
              display: "flex",
            }}
          >
            {title}
          </div>

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
                color: colors.accent,
                fontFamily: "monospace",
                display: "flex",
              }}
            >
              {accession}
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
            Explore sequencing datasets • Unified metadata views
          </div>
        </div>
      </div>
    ),
    projectOgSize,
  );
}
