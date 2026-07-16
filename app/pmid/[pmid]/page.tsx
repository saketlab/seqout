"use client";

import PublicationProjectsBody from "@/components/publication-projects-body";
import { useParams } from "next/navigation";

export default function PublicationProjectsPage() {
  const params = useParams();
  const raw = params.pmid;
  const pmid = Array.isArray(raw) ? raw[0] : (raw ?? "");
  return <PublicationProjectsBody key={pmid} pmid={pmid} />;
}
