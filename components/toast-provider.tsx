"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * A small, intentional toast system for success confirmations.
 *
 * Design goals:
 *   1. Close the feedback loop on copy actions (accession, BibTeX, script,
 *      citation, chart). The icon swap already gives sighted users local
 *      feedback; this adds a global announcement that's screen-reader
 *      friendly via `role="status" aria-live="polite"`.
 *   2. Stay quiet. Auto-dismisses in 2s. Bottom-center placement, pill
 *      shape, inverted gray background. No emoji, no exclamation marks —
 *      matches the "fast, scholarly, precise" brand voice.
 *   3. Latest-wins: if a new toast fires while one is visible, it replaces
 *      the message and restarts the timer. No queue, no stacking.
 *   4. Respects `prefers-reduced-motion` — drops the slide-up on enter.
 */

type ToastContextValue = {
  showToast: (message: ReactNode) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be called inside <ToastProvider>");
  }
  return ctx;
}

const AUTO_DISMISS_MS = 2000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<ReactNode | null>(null);
  // Bumped on every new toast so CSS animation restarts even when the
  // previous toast is still visible (React re-mounts the keyed child).
  const [tick, setTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((next: ReactNode) => {
    setMessage(next);
    setTick((t) => t + 1);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setMessage(null);
      timerRef.current = null;
    }, AUTO_DISMISS_MS);
  }, []);

  // Clean up the timer on unmount so it doesn't fire after teardown.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        // `role="status"` + `aria-live="polite"` announces the toast text
        // to screen readers without interrupting the current utterance.
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "fixed",
          left: "50%",
          bottom: "2rem",
          transform: "translateX(-50%)",
          // Above sticky search bar (z-index 1100), below modal/dialog
          // overlays (Radix uses z-index ~2147483647 for those, so 2000
          // is fine for our own stacking).
          zIndex: 2000,
          pointerEvents: "none",
        }}
      >
        {message && (
          <div
            key={tick}
            className="seqout-toast"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.625rem 1.125rem",
              borderRadius: "999px",
              background: "var(--gray-12)",
              color: "var(--gray-1)",
              fontSize: "0.875rem",
              lineHeight: 1.2,
              boxShadow:
                "0 10px 32px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)",
              border: "1px solid var(--gray-a6)",
              maxWidth: "min(90vw, 28rem)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              pointerEvents: "auto",
            }}
          >
            <CheckSpark />
            <span>{message}</span>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/** Small checkmark icon sized for the toast, inlined to avoid extra deps. */
function CheckSpark() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      style={{ flexShrink: 0, color: "var(--accent-8)" }}
    >
      <path
        d="M2.5 7.5L5.5 10.5L11.5 3.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
