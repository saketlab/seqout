"use client";

import { useParams } from "next/navigation";
import AuthorProjectsBody from "@/components/author-projects-body";

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // malformed %-sequence, use as-is rather than crash
  }
}

export default function AuthorProjectsPage() {
  const params = useParams();
  // useParams() returns the raw encoded segment; decode before use.
  const raw = params.name;
  const name = safeDecode(Array.isArray(raw) ? raw[0] : (raw ?? ""));
  return <AuthorProjectsBody key={name} name={name} />;
}
