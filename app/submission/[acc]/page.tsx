"use client";

import SubmissionStudiesBody from "@/components/submission-studies-body";
import { useParams } from "next/navigation";

export default function SubmissionStudiesPage() {
  const params = useParams();
  const raw = params.acc;
  const acc = Array.isArray(raw) ? raw[0] : (raw ?? "");
  return <SubmissionStudiesBody key={acc} accession={acc} />;
}
