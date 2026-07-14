"use client";

import Footer from "@/components/footer";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const PROJECT_READY_EVENT = "seqout:project-ready";

export default function FooterGate() {
  const pathname = usePathname();
  const isProjectPage = pathname.startsWith("/p/");
  const isSearchResultsPage = pathname === "/search";
  const isAuthorsPage = pathname === "/authors" || pathname.startsWith("/authors/");
  const isMapPage = pathname === "/map";
  const [readyPathname, setReadyPathname] = useState<string | null>(null);

  useEffect(() => {
    if (!isProjectPage) return;

    const handleProjectReady = () => setReadyPathname(pathname);
    window.addEventListener(PROJECT_READY_EVENT, handleProjectReady);

    return () => {
      window.removeEventListener(PROJECT_READY_EVENT, handleProjectReady);
    };
  }, [isProjectPage, pathname]);

  const isVisible =
    !isSearchResultsPage &&
    !isAuthorsPage &&
    !isMapPage &&
    (!isProjectPage || readyPathname === pathname);

  if (!isVisible) return null;

  return <Footer />;
}
