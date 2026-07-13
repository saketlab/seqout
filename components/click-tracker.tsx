"use client";

import { track } from "@/utils/analytics";
import { useEffect } from "react";

// One delegated listener for the whole app — reports every button/link click to
// GA4 with a human-readable label, so we get "what's getting clicked" without
// touching each button. Capture phase so it fires even if a handler stops
// propagation. Label is best-effort (aria-label > text > href).
export default function ClickTracker() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const el = target?.closest<HTMLElement>("button, a, [role='button']");
      if (!el) return;
      const label =
        el.getAttribute("aria-label")?.trim() ||
        el.textContent?.trim().slice(0, 100) ||
        el.getAttribute("href") ||
        "(unlabeled)";
      const href = el.getAttribute("href") ?? undefined;
      track("ui_click", {
        label,
        tag: el.tagName.toLowerCase(),
        ...(href ? { href } : {}),
        path: window.location.pathname,
      });
    };
    document.addEventListener("click", onClick, { capture: true });
    return () =>
      document.removeEventListener("click", onClick, { capture: true });
  }, []);

  return null;
}
