"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const REVEAL_SECONDS = 30;

type State =
  | { kind: "masked" }
  | { kind: "pending" }
  | { kind: "revealed"; value: string }
  | { kind: "refused"; message: string };

/**
 * A masked value with a logged reveal. The server decides whether the person
 * may see it; the value lives only in this component's memory for 30 seconds
 * and is never written to storage, the URL or a cookie.
 */
export function SensitiveValue({ refId, field, masked, label }: { refId: string; field: string; masked: string; label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "masked" });

  useEffect(() => {
    if (state.kind !== "revealed") return;
    const timer = setTimeout(() => setState({ kind: "masked" }), REVEAL_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [state]);

  const reveal = async () => {
    setState({ kind: "pending" });
    try {
      const res = await fetch("/api/reveal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: refId, field }),
        cache: "no-store",
      });
      const data = (await res.json()) as { ok: true; value: string } | { ok: false; message: string };
      setState(data.ok ? { kind: "revealed", value: data.value } : { kind: "refused", message: data.message });
    } catch {
      setState({ kind: "refused", message: "Could not reach the server." });
    } finally {
      // The view log is server-rendered; refresh so the new entry shows.
      router.refresh();
    }
  };

  const name = label ?? field.replace(/_/g, " ");
  if (state.kind === "revealed") {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="num rounded bg-amber-50 px-1 text-amber-900">{state.value}</span>
        <button type="button" onClick={() => setState({ kind: "masked" })} className="rounded border border-stone-300 bg-white px-2 py-0.5 text-xs hover:bg-stone-100">
          Hide
        </button>
        <span className="text-xs text-stone-500">this view was logged; hides in {REVEAL_SECONDS} seconds</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="num">{masked}</span>
      <button
        type="button"
        disabled={state.kind === "pending"}
        onClick={() => void reveal()}
        className="rounded border border-stone-300 bg-white px-2 py-0.5 text-xs hover:bg-stone-100 disabled:opacity-50"
        title={`Reveal ${name} (logged)`}
      >
        {state.kind === "pending" ? "Checking" : "Reveal"}
      </button>
      {state.kind === "refused" ? (
        <span className="text-xs text-red-700" role="alert">
          {state.message}
        </span>
      ) : null}
    </span>
  );
}
