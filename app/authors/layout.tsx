import { ARCHIVE_LIST_TEXT } from "@/utils/constants";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Find projects by author",
  description: `Search ${ARCHIVE_LIST_TEXT} datasets by researcher name on seqout.`,
  alternates: {
    canonical: "/authors",
  },
};

export default function AuthorsLayout({ children }: { children: ReactNode }) {
  return children;
}
