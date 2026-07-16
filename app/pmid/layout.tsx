import { ARCHIVE_LIST_TEXT } from "@/utils/constants";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Find projects by PMID",
  description: `Look up every ${ARCHIVE_LIST_TEXT} dataset linked to a PubMed ID on seqout.`,
  alternates: {
    canonical: "/pmid",
  },
};

export default function PublicationsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
