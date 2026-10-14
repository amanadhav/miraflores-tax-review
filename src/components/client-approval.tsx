"use client";

import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";

const primary = "rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50";

/**
 * approve_return: the client's acknowledgement bound to the presented
 * snapshot. The server checks that the presentation is still current and
 * that its hash still matches the workpaper before recording the simulated
 * signature.
 */
export function ClientApprovalForm({ revision, snapshotId, canApprove, blockedReason }: { revision: number; snapshotId: string; canApprove: boolean; blockedReason: string | null }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [acknowledged, setAcknowledged] = useState(false);
  const [done, setDone] = useState<{ complete: boolean } | null>(null);
  if (!canApprove) return <p className="text-sm text-stone-600">{blockedReason ?? "Approval is not open right now."}</p>;
  return (
    <form
      className="space-y-3 rounded border border-stone-200 bg-stone-50 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!acknowledged) return;
        const r = await send("approve_return", { snapshotId, acknowledgement: true });
        if (r.ok) setDone(r.result as { complete: boolean });
      }}
    >
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
        <span>I have reviewed the return and sign the e-file authorization (simulated).</span>
      </label>
      <p className="text-xs text-stone-500">
        Your approval is bound to this exact presentation (its content hash). If the firm changes anything afterwards, the approval reopens and you will be asked again. This is a
        simulated signature: nothing is sent to any agency.
      </p>
      <button type="submit" disabled={pending || !acknowledged} className={primary}>
        {pending ? "Saving" : "Approve and sign (simulated)"}
      </button>
      {done ? (
        <p className="text-xs text-emerald-700">
          {done.complete ? "Recorded. Both of you have approved; the firm can now submit the return." : "Recorded. The return will be submitted once the other spouse approves too."}
        </p>
      ) : null}
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}
