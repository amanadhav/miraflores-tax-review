"use client";

import { useEffect } from "react";

/** Scrolls the finding named by ?finding= into view once the page has rendered. */
export function FindingFocus({ findingId }: { findingId: string | null }) {
  useEffect(() => {
    if (!findingId) return;
    const el = document.getElementById(findingId);
    if (el) el.scrollIntoView({ block: "center" });
  }, [findingId]);
  return null;
}
