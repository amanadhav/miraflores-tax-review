"use client";

import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";

/**
 * Accept or reject a proposal, or undo an accepted change. Every button sends
 * the command with the revision this screen was rendered from; the server's
 * own refusal (no self-review, partner threshold, permission) is shown as is.
 */
export function AdjustmentActions({
  adjustmentId,
  status,
  revision,
  canDecide,
  canUndo,
  decideWarning,
}: {
  adjustmentId: string;
  status: string;
  revision: number;
  canDecide: boolean;
  canUndo: boolean;
  decideWarning: string | null;
}) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);

  if (done) return <p className="text-xs text-emerald-700">{done}</p>;

  if (status === "proposed") {
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} className="min-w-48 flex-1 rounded border border-stone-300 bg-white px-2 py-1 text-xs" placeholder="Decision note (optional)" />
          <button
            type="button"
            disabled={pending}
            title={decideWarning ?? "Accept this change; it becomes the effective value"}
            onClick={async () => {
              const r = await send("decide_adjustment", { adjustmentId, decision: "accept", note: note.trim() || undefined });
              if (r.ok) setDone("Accepted.");
            }}
            className={`rounded px-3 py-1 text-xs font-medium disabled:opacity-50 ${decideWarning ? "border border-stone-300 bg-white text-stone-500 hover:bg-stone-100" : "bg-emerald-700 text-white hover:bg-emerald-600"}`}
          >
            Accept
          </button>
          <button
            type="button"
            disabled={pending}
            title={!canDecide ? decideWarning ?? "Not permitted" : "Reject this proposal; it stays in history"}
            onClick={async () => {
              const r = await send("decide_adjustment", { adjustmentId, decision: "reject", note: note.trim() || undefined });
              if (r.ok) setDone("Rejected.");
            }}
            className="rounded border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
        {decideWarning ? <p className="text-xs text-stone-500">{decideWarning}</p> : null}
        <CommandErrorBox error={error} onDismiss={clearError} />
      </div>
    );
  }

  if (status === "accepted") {
    return (
      <div>
        <button
          type="button"
          disabled={pending}
          title={canUndo ? "Append a compensating entry that restores the former value" : "Only reviewers and partners can undo accepted changes"}
          onClick={async () => {
            if (!window.confirm("Undo this accepted change? A compensating entry restores the former value; history is kept.")) return;
            const reason = window.prompt("Reason for the undo (optional)") ?? undefined;
            const r = await send("undo_adjustment", { adjustmentId, reason: reason?.trim() || undefined });
            if (r.ok) setDone("Undone with a compensating entry.");
          }}
          className="rounded border border-stone-300 bg-white px-3 py-1 text-xs hover:bg-stone-100 disabled:opacity-50"
        >
          Undo
        </button>
        {!canUndo ? <span className="ml-2 text-xs text-stone-500">Only reviewers and partners can undo; the server will refuse this.</span> : null}
        <CommandErrorBox error={error} onDismiss={clearError} />
      </div>
    );
  }
  return null;
}
