"use client";
import { IconButton, Tooltip } from "@radix-ui/themes";
import { useSyncExternalStore } from "react";

// User-wide preference shared by the project data tables (fastQ, experiments,
// samples, enriched). Grids read it via useWrapText(); toolbars flip it via
// <WrapTextToggle/>. Kept in localStorage + a custom event so all mounted grids
// stay in sync without threading props through their parents.
const KEY = "seqout:wrap-text";
const EVENT = "seqout:wrap-text-change";

function subscribe(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

const getSnapshot = (): boolean => window.localStorage.getItem(KEY) === "1";
const getServerSnapshot = (): boolean => false;

/** Subscribe to the shared wrap-text preference (false until hydrated). */
export function useWrapText(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function setWrapText(next: boolean): void {
  window.localStorage.setItem(KEY, next ? "1" : "0");
  window.dispatchEvent(new Event(EVENT));
}

function WrapIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M2 3.5h11M2 7.5h8.5a2 2 0 1 1 0 4H8m0 0 1.5-1.5M8 11.5l1.5 1.5M2 11.5h3"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Small toolbar toggle that flips text wrapping for all data tables. */
export function WrapTextToggle({ size = "2" }: { size?: "1" | "2" | "3" }) {
  const wrap = useWrapText();
  return (
    <Tooltip content={wrap ? "Wrapping long text" : "Wrap long text"}>
      <IconButton
        size={size}
        variant={wrap ? "solid" : "surface"}
        color={wrap ? undefined : "gray"}
        onClick={() => setWrapText(!wrap)}
        aria-label="Toggle text wrapping in tables"
        aria-pressed={wrap}
      >
        <WrapIcon />
      </IconButton>
    </Tooltip>
  );
}
