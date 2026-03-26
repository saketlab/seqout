import { useEffect } from "react";

/**
 * Updates the URL hash as the user scrolls past section elements.
 * Uses IntersectionObserver to detect which section is at the top of the viewport.
 * A MutationObserver re-scans for late-mounting sections (e.g. enriched card after fetch).
 */
export function useScrollSpy(sectionIds: string[]) {
  const key = sectionIds.join(",");

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) return;

    const visibleSet = new Set<string>();
    let rafId = 0;

    const update = () => {
      const active = ids.find((id) => visibleSet.has(id));
      const current = window.location.hash.slice(1);
      if (active && active !== current) {
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${active}`);
      } else if (!active && current) {
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleSet.add(entry.target.id);
          } else {
            visibleSet.delete(entry.target.id);
          }
        }
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(update);
      },
      { rootMargin: "-10% 0px -80% 0px" },
    );

    const observed = new Set<string>();
    const scan = () => {
      for (const id of ids) {
        if (observed.has(id)) continue;
        const el = document.getElementById(id);
        if (el) {
          observer.observe(el);
          observed.add(id);
        }
      }
    };
    scan();

    const mutation = new MutationObserver(scan);
    mutation.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      mutation.disconnect();
    };
  }, [key]);
}
