"use client";

import { useState } from "react";
import { CommandButton, CommandErrorBox, useCommand } from "@/components/command-client";
import type { ActionGate, EfileScriptView, SubmissionView } from "@/server/queries/filing";

const input = "mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm";
const label = "block text-xs text-stone-500";
const primary = "rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50";
const secondary = "rounded border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50";

function WhoMay({ gate, action }: { gate: ActionGate; action: string }) {
  return (
    <p className="text-xs text-stone-500">
      {action}: {gate.who}.{" "}
      {gate.allowed ? <span className="text-emerald-700">You may do this.</span> : <span className="text-amber-800">Your role cannot; the server will refuse it.</span>}
    </p>
  );
}

/** present_to_client: freezes a hashed presentation when every required step is satisfied. */
export function PresentForm({ revision, gate }: { revision: number; gate: ActionGate }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  return (
    <form
      className="space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send("present_to_client", { note: note.trim() || undefined });
        if (r.ok) setDone((r.result as { contentHash: string }).contentHash);
      }}
    >
      <h3 className="text-sm font-medium">Present to client</h3>
      <WhoMay gate={gate} action="Who may present" />
      <p className="text-xs text-stone-600">
        The server re-evaluates every required step inside the command, freezes the presentation as a content-hashed snapshot and notifies both clients. A failed step is reported, not skipped.
      </p>
      <label className={label}>
        Note to the record (optional)
        <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Presentation after the June review" />
      </label>
      <button type="submit" disabled={pending} className={primary}>
        {pending ? "Saving" : "Present to client"}
      </button>
      {done ? (
        <p className="text-xs text-emerald-700">
          Presented; frozen presentation <span className="num">{done.slice(0, 16)}</span>.
        </p>
      ) : null}
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}

/** submit_filing: simulated transmission of both returns; California is held until federal acceptance. */
export function SubmitPanel({ revision, gate }: { revision: number; gate: ActionGate }) {
  return (
    <div className="space-y-2 rounded border border-stone-200 bg-stone-50 p-3">
      <h3 className="text-sm font-medium">Submit (simulated transmission)</h3>
      <WhoMay gate={gate} action="Who may submit" />
      <p className="text-xs text-stone-600">
        Readiness and both approvals are re-checked inside the command. The payload is frozen per attempt, the workpaper is locked, and the California attempt is held until the federal return is accepted. Nothing is transmitted to any agency.
      </p>
      <CommandButton revision={revision} type="submit_filing" payload={{ jurisdictions: ["federal", "california"] }} className={primary} confirm="Submit the federal and California returns (simulated transmission) and freeze the workpaper?">
        Submit federal and California (simulated)
      </CommandButton>
    </div>
  );
}

function scriptLabel(s: EfileScriptView): string {
  const when = s.date.slice(0, 16).replace("T", " ");
  const errs = s.errors.map((e) => `${e.code}: ${e.message}`).join("; ");
  return `Packet e-file record ${s.index}: ${s.jurisdiction} ${s.status} on ${when}, simulated agency id ${s.submissionId}${errs ? `, ${errs}` : ""}`;
}

/** record_submission_outcome for one transmitted attempt: typed outcome or the packet's scripted response. */
export function OutcomeForm({ revision, submission, gate }: { revision: number; submission: SubmissionView; gate: ActionGate }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const base = { submissionId: submission.id };
  return (
    <div className="space-y-2 rounded border border-stone-200 bg-stone-50 p-3">
      <h3 className="text-sm font-medium">
        Record the agency response for {submission.jurisdiction} attempt <span className="num">{submission.attempt}</span>{" "}
        <span className="num text-xs text-stone-500">({submission.submissionRef}, simulated)</span>
      </h3>
      <WhoMay gate={gate} action="Who may record responses" />
      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          disabled={pending}
          className={primary}
          onClick={async () => {
            const r = await send("record_submission_outcome", { ...base, outcome: "accepted" });
            if (r.ok) setDone("accepted");
          }}
        >
          Record acceptance (simulated)
        </button>
      </div>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await send("record_submission_outcome", { ...base, outcome: "rejected", errors: [{ code: code.trim(), message: message.trim() }] });
          if (r.ok) setDone("rejected");
        }}
      >
        <label className={label}>
          Rejection code
          <input className={`${input} num`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="R0000-504-02" />
        </label>
        <label className={label}>
          Rejection message
          <input className={input} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What the agency said" />
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={pending || !code.trim() || !message.trim()} className={secondary}>
            Record rejection (simulated)
          </button>
        </div>
      </form>
      {submission.scripts.length ? (
        <div className="space-y-1">
          <p className="text-xs text-stone-500">Replay the packet&apos;s scripted response (uses fromPacketEfileIndex; the packet text is shown next to each):</p>
          <ul className="space-y-1">
            {submission.scripts.map((s) => (
              <li key={s.index} className="flex flex-wrap items-start gap-2 text-xs">
                <button
                  type="button"
                  disabled={pending}
                  className={secondary}
                  onClick={async () => {
                    const r = await send("record_submission_outcome", { ...base, outcome: s.outcome, fromPacketEfileIndex: s.index });
                    if (r.ok) setDone(s.outcome ?? "recorded");
                  }}
                >
                  Replay index {s.index}: {s.outcome}
                </button>
                <span className="text-stone-600">{scriptLabel(s)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {done ? <p className="text-xs text-emerald-700">Recorded as {done} (simulated).</p> : null}
      <CommandErrorBox error={error} onDismiss={clearError} />
    </div>
  );
}

/** start_amendment: branches a new workspace from the accepted snapshot; the original stays frozen. */
export function AmendForm({ revision, gate }: { revision: number; gate: ActionGate }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [reason, setReason] = useState("");
  const [created, setCreated] = useState<{ amendmentWorkspaceId: string; amendsSnapshotId: string } | null>(null);
  return (
    <form
      className="space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send("start_amendment", { reason: reason.trim() });
        if (r.ok) setCreated(r.result as { amendmentWorkspaceId: string; amendsSnapshotId: string });
      }}
    >
      <h3 className="text-sm font-medium">Start an amendment</h3>
      <WhoMay gate={gate} action="Who may start an amendment" />
      <p className="text-xs text-stone-600">
        A new workspace branches from the accepted snapshot with the accepted changes carried as accepted (each marked with its origin). This workspace stays frozen.
      </p>
      <label className={label}>
        Reason (recorded in both workspaces)
        <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the filed return must change" />
      </label>
      <button type="submit" disabled={pending || reason.trim().length < 3} className={primary}>
        {pending ? "Saving" : "Start amendment"}
      </button>
      {created ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <p>
            Amendment workspace <span className="num font-medium">{created.amendmentWorkspaceId}</span> created from snapshot{" "}
            <span className="num">{created.amendsSnapshotId}</span>.
          </p>
          <p className="mt-1">
            To work in it: open the landing page in a browser, use the <strong>Join an existing workspace</strong> form, paste this id as the workspace id and choose who to join as. The
            amendment starts in the amending state with its own revision counter.
          </p>
        </div>
      ) : null}
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}

/** start_next_year: the 2026 successor record (carryovers, basis histories, open items), never a computed return. */
export function NextYearForm({ revision, gate }: { revision: number; gate: ActionGate }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [note, setNote] = useState("");
  const [created, setCreated] = useState<{ carryforwardId: string; planningTaskId: string } | null>(null);
  return (
    <form
      className="space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send("start_next_year", { note: note.trim() || undefined });
        if (r.ok) setCreated(r.result as { carryforwardId: string; planningTaskId: string });
      }}
    >
      <h3 className="text-sm font-medium">Start next year&apos;s record</h3>
      <WhoMay gate={gate} action="Who may start it" />
      <p className="text-xs text-stone-600">
        Creates a carryforward snapshot (carryovers out, basis histories, open findings and tasks, judgments to revisit, the 2026 planning reference) and a safe-harbor planning task. No 2026
        computation exists; it is intended after acceptance and notes when no accepted filing exists.
      </p>
      <label className={label}>
        Note (optional)
        <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Handoff note for the 2026 engagement" />
      </label>
      <button type="submit" disabled={pending} className={secondary}>
        {pending ? "Saving" : "Start next year"}
      </button>
      {created ? (
        <p className="text-xs text-emerald-700">
          Carryforward <span className="num">{created.carryforwardId}</span> created with planning task <span className="num">{created.planningTaskId}</span>. Export it from the
          snapshots table.
        </p>
      ) : null}
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}
