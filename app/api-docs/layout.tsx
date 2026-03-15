import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Reference",
  description:
    "Programmatic access to 1M+ GEO, SRA, ENA & ArrayExpress projects. Free, no auth required. Endpoints for search, project metadata, downloads, statistics, and more.",
  alternates: {
    canonical: "https://seqout.org/api-docs",
  },
};

export default function ApiDocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
