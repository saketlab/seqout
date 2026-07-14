"use client";

// Pulsing dot that nags first-time users toward a feature they've never used,
// and the localStorage flag that retires it once they have.

import type { CSSProperties } from "react";
import { useSyncExternalStore } from "react";

const EVENT = "seqout-first-visit-ping-change";

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * `[seen, markSeen]` for one feature, persisted under `key`. Server snapshot is
 * `true` so the ping never flashes on a hydrating page for a returning user.
 */
export function useFirstVisit(key: string): [boolean, () => void] {
  const seen = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(key) === "true",
    () => true,
  );
  const markSeen = () => {
    window.localStorage.setItem(key, "true");
    window.dispatchEvent(new Event(EVENT));
  };
  return [seen, markSeen];
}

/** Absolutely positioned — the parent needs `position: relative`. */
export function FirstVisitPing({ style }: { style?: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        top: "-3px",
        left: "-3px",
        display: "flex",
        height: "8px",
        width: "8px",
        ...style,
      }}
    >
      <span
        className="animate-ping"
        style={{
          position: "absolute",
          display: "inline-flex",
          height: "100%",
          width: "100%",
          borderRadius: "9999px",
          backgroundColor: "var(--red-9)",
          opacity: 0.75,
        }}
      />
      <span
        style={{
          position: "relative",
          display: "inline-flex",
          borderRadius: "9999px",
          height: "8px",
          width: "8px",
          backgroundColor: "var(--red-9)",
        }}
      />
    </span>
  );
}
