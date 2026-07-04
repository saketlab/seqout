// Thin wrapper over the gtag.js already loaded in app/layout.tsx. GA4
// auto-tracks page views; this is for custom events (search, clicks).
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function track(event: string, params?: Record<string, unknown>) {
  if (typeof window !== "undefined") window.gtag?.("event", event, params);
}
