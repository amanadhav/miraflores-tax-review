"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Records that this person has looked at the workpaper up to the saved
 * revision. The cursor lives on the server per workspace and actor; this
 * button never stores a browser timestamp.
 */
export function MarkSeenButton({ revision }: { revision: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const res = await fetch("/api/session/seen", { method: "POST" });
            if (!res.ok) throw new Error(`The server answered ${res.status}.`);
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not record the cursor.");
          } finally {
            setPending(false);
          }
        }}
        className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100 disabled:opacity-50"
      >
        {pending ? "Saving" : `Mark as seen up to revision ${revision}`}
      </button>
      {error ? (
        <span className="text-xs text-red-700" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
