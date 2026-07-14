import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Find projects by author",
  description:
    "Search GEO, SRA, ENA, DRA, GEA, GSA, and ArrayExpress datasets by researcher name on seqout.",
  alternates: {
    canonical: "/authors",
  },
};

export default function AuthorsLayout({ children }: { children: ReactNode }) {
  return children;
}
