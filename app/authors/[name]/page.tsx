"use client";

import { useParams } from "next/navigation";
import AuthorProjectsBody from "@/components/author-projects-body";

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // ponytail: malformed %-sequence, use as-is rather than crash
  }
}

export default function AuthorProjectsPage() {
  const params = useParams();
  // useParams() returns the raw encoded segment ("Joseph%20E%20Powell"), so
  // decode here — otherwise the name renders with %20 and the API call double-encodes.
  const raw = params.name;
  const name = safeDecode(Array.isArray(raw) ? raw[0] : (raw ?? ""));
  return <AuthorProjectsBody name={name} />;
}
