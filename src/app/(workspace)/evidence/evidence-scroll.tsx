"use client";

import { useEffect } from "react";

/**
 * Scrolls to the first element whose id matches one of the given ids (or the
 * URL hash) once the server-rendered page is on screen. Ids can contain
 * characters like ":" and "/", so lookup uses getElementById, not a selector.
 */
export function EvidenceScroll({ ids }: { ids: string[] }) {
  useEffect(() => {
    const candidates = [...ids];
    if (typeof window !== "undefined" && window.location.hash.length > 1) {
      try {
        candidates.unshift(decodeURIComponent(window.location.hash.slice(1)));
      } catch {
        candidates.unshift(window.location.hash.slice(1));
      }
    }
    for (const id of candidates) {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        break;
      }
    }
  }, [ids]);
  return null;
}
