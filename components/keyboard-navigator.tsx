"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

function isInputContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  // Radix Dialog / Popover focus traps — don't hijack their keys.
  if (target.closest('[role="dialog"]')) return true;
  return false;
}

export default function KeyboardNavigator() {
  const router = useRouter();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (event.key !== "Backspace") {
        return;
      }
      if (isInputContext(event.target)) return;
      if (window.history.length <= 1) return;
      event.preventDefault();
      router.back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return null;
}
