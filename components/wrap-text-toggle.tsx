"use client";
import { IconButton, Tooltip } from "@radix-ui/themes";
import { useCallback, useSyncExternalStore } from "react";

// Per-scope wrap-text preference. Each `scope` is an independent toggle (e.g.
// "table" for samples/experiments, "fastq" for the FASTQ files table). Grids
// read it via useWrapText(scope); toolbars flip it via <WrapTextToggle scope/>.
// Kept in localStorage + a custom event so all mounted grids of a scope stay in
// sync without threading props through their parents.
const KEY_PREFIX = "seqout:wrap-text";
const EVENT = "seqout:wrap-text-change";
const keyFor = (scope: string): string => `${KEY_PREFIX}:${scope}`;

function subscribe(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

const getServerSnapshot = (): boolean => false;

/** Subscribe to a scoped wrap-text preference (false until hydrated). */
export function useWrapText(scope = "table"): boolean {
  const getSnapshot = useCallback(
    (): boolean => window.localStorage.getItem(keyFor(scope)) === "1",
    [scope],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function setWrapText(scope: string, next: boolean): void {
  window.localStorage.setItem(keyFor(scope), next ? "1" : "0");
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

/** Small toolbar toggle that flips text wrapping for one scope's data tables. */
export function WrapTextToggle({
  scope = "table",
  size = "2",
}: {
  scope?: string;
  size?: "1" | "2" | "3";
}) {
  const wrap = useWrapText(scope);
  return (
    <Tooltip content={wrap ? "Wrapping long text" : "Wrap long text"}>
      <IconButton
        size={size}
        variant={wrap ? "solid" : "outline"}
        color={wrap ? undefined : "gray"}
        onClick={() => setWrapText(scope, !wrap)}
        aria-label="Toggle text wrapping in tables"
        aria-pressed={wrap}
      >
        <WrapIcon />
      </IconButton>
    </Tooltip>
  );
}
