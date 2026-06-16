"use client";
import dynamic from "next/dynamic";

const RunDetailPage = dynamic(() => import("@/components/run-detail-page"), {
  ssr: false,
});

export default function RunPage() {
  return <RunDetailPage />;
}
