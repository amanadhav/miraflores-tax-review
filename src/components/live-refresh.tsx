"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Polls the saved revision and refreshes server-rendered data when someone
 * else changes the workpaper. State comes from the database, never from this
 * browser, so two sessions always converge on the same saved revision.
 */
export function LiveRefresh({ revision }: { revision: number }) {
  const router = useRouter();
  const seen = useRef(revision);
  const [status, setStatus] = useState<"live" | "updated" | "offline">("live");

  useEffect(() => {
    seen.current = revision;
  }, [revision]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/workspace/revision", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { revision: number };
        if (cancelled) return;
        if (data.revision !== seen.current) {
          seen.current = data.revision;
          setStatus("updated");
          router.refresh();
          setTimeout(() => setStatus("live"), 2500);
        } else {
          setStatus("live");
        }
      } catch {
        if (!cancelled) setStatus("offline");
      }
    };
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [router]);

  return (
    <span className="flex items-center gap-1 text-xs text-stone-500" title="Saved revision; refreshes when a colleague changes something">
      <span className={`inline-block h-2 w-2 rounded-full ${status === "offline" ? "bg-red-500" : status === "updated" ? "bg-amber-500" : "bg-emerald-500"}`} />
      rev {revision}
      {status === "updated" ? ", updated" : status === "offline" ? ", offline" : ""}
    </span>
  );
}
