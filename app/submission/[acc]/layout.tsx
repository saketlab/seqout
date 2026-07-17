import { ARCHIVE_LIST_TEXT } from "@/utils/constants";
import type { Metadata } from "next";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  params: Promise<{ acc: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { acc } = await params;
  return {
    title: `Submission ${acc} - Studies`,
    description: `Sequencing studies filed under submission ${acc} across ${ARCHIVE_LIST_TEXT}.`,
    alternates: {
      canonical: `/submission/${encodeURIComponent(acc)}`,
    },
    robots: { index: false, follow: true },
  };
}

export default function SubmissionLayout({ children }: Props) {
  return children;
}
