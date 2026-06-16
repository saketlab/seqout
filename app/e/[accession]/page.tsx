"use client";
import dynamic from "next/dynamic";

const ExperimentDetailPage = dynamic(
  () => import("@/components/experiment-detail-page"),
  { ssr: false },
);

export default function ExperimentPage() {
  return <ExperimentDetailPage />;
}
