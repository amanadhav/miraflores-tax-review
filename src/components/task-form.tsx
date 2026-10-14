"use client";

import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";
import { parseRefs } from "@/components/finding-forms";
import { endOfDayIso } from "@/components/request-form";

const input = "mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm";
const label = "block text-xs text-stone-500";
const primary = "rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50";
const secondary = "rounded border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50";

type TaskKind = "review" | "outside_filing" | "follow_up" | "planning";

export interface TaskDefaults {
  kind?: TaskKind;
  title?: string;
  detail?: string;
  refs?: string[];
  dueDate?: string;
  ownerId?: string;
  area?: string;
}

/** Assign a task to a member of staff (command create_task). */
export function TaskCreateForm({
  revision,
  canCreate,
  actorRole,
  owners,
  areas,
  defaults = {},
  buttonLabel = "New task",
  startOpen = false,
}: {
  revision: number;
  canCreate: boolean;
  actorRole: string;
  owners: { id: string; name: string; role: string; available?: boolean }[];
  areas: { id: string; label: string }[];
  defaults?: TaskDefaults;
  buttonLabel?: string;
  startOpen?: boolean;
}) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [open, setOpen] = useState(startOpen);
  const [kind, setKind] = useState<TaskKind>(defaults.kind ?? "review");
  const [title, setTitle] = useState(defaults.title ?? "");
  const [detail, setDetail] = useState(defaults.detail ?? "");
  const [ownerId, setOwnerId] = useState(defaults.ownerId ?? owners[0]?.id ?? "");
  const [dueDate, setDueDate] = useState(defaults.dueDate ?? "");
  const [refs, setRefs] = useState((defaults.refs ?? []).join(", "));
  const [area, setArea] = useState(defaults.area ?? "");
  const [created, setCreated] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondary} onClick={() => setOpen(true)}>
          {buttonLabel}
        </button>
        {created ? (
          <span className="text-xs text-emerald-700">
            Task <span className="num">{created}</span> assigned.
          </span>
        ) : null}
        {!canCreate ? <span className="text-xs text-stone-500">A {actorRole} cannot assign tasks.</span> : null}
      </div>
    );
  }
  return (
    <form
      className="space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send("create_task", {
          kind,
          title,
          detail,
          ownerId,
          dueAt: endOfDayIso(dueDate),
          refs: parseRefs(refs),
          area: area || undefined,
        });
        if (r.ok) {
          setCreated((r.result as { taskId: string }).taskId);
          setTitle("");
          setDetail("");
          setOpen(false);
        }
      }}
    >
      {!canCreate ? <p className="text-xs text-amber-800">A {actorRole} cannot assign tasks; the server will refuse this.</p> : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={label}>
          Kind
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value as TaskKind)}>
            <option value="review">Review</option>
            <option value="follow_up">Follow-up</option>
            <option value="outside_filing">Outside filing (needs evidence to close)</option>
            <option value="planning">Planning</option>
          </select>
        </label>
        <label className={label}>
          Owner
          <select className={input} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} required>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.role}){o.available === false ? ", not yet active" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Due (optional)
          <input type="date" className={`${input} num`} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
      </div>
      <label className={label}>
        Title
        <input className={input} required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className={label}>
        Detail
        <textarea className={input} rows={2} required minLength={1} maxLength={4000} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="What has to happen and what would show it is done" />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={label}>
          References (comma separated)
          <input className={`${input} num`} value={refs} onChange={(e) => setRefs(e.target.value)} placeholder="D27, call-01" />
        </label>
        <label className={label}>
          Area (optional; otherwise taken from the first reference)
          <select className={input} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">From the references</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {kind === "outside_filing" ? (
        <p className="text-xs text-stone-600">An outside filing is not part of this return. It can only be marked done with evidence of the filing or the client&apos;s acknowledgment, cited as an attachment or a reply.</p>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving" : "Assign task"}
        </button>
        <button type="button" className={secondary} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}

/** Mark a task done or cancelled with a note and, for outside filings, evidence (command complete_task). */
export function TaskCompleteForm({ taskId, kind, revision, canComplete, actorRole, ownerName }: { taskId: string; kind: string; revision: number; canComplete: boolean; actorRole: string; ownerName: string }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<"done" | "cancelled">("done");
  const [note, setNote] = useState("");
  const [refs, setRefs] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const outside = kind === "outside_filing";

  if (done) return <p className="mt-1 text-xs text-emerald-700">Task {done}.</p>;
  if (!open) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button type="button" className={secondary} onClick={() => setOpen(true)}>
          Complete
        </button>
        {!canComplete ? <span className="text-xs text-stone-500">Only {ownerName} or someone who manages assignments can complete this.</span> : null}
      </div>
    );
  }
  return (
    <form
      className="mt-2 space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send("complete_task", { taskId, outcome, note, evidenceRefs: parseRefs(refs) });
        if (r.ok) setDone(outcome);
      }}
    >
      {!canComplete ? <p className="text-xs text-amber-800">A {actorRole} who does not own this task cannot complete it; the server will refuse this.</p> : null}
      {outside ? (
        <p className="text-xs text-amber-800">
          Outside filing: marking it done needs evidence (attach the filing confirmation or the client&apos;s acknowledgment and cite it, for example attachment:att_xxx or reply:rpl_xxx). A note alone is refused.
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={label}>
          Outcome
          <select className={input} value={outcome} onChange={(e) => setOutcome(e.target.value as "done" | "cancelled")}>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className={label}>
          Evidence references{outside && outcome === "done" ? " (required)" : " (optional)"}
          <input className={`${input} num`} value={refs} onChange={(e) => setRefs(e.target.value)} placeholder="attachment:att_..., reply:rpl_..." required={outside && outcome === "done"} />
        </label>
      </div>
      <label className={label}>
        Note
        <textarea className={input} rows={2} required minLength={1} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done, or why it was cancelled" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving" : outcome === "done" ? "Mark done" : "Cancel task"}
        </button>
        <button type="button" className={secondary} onClick={() => setOpen(false)}>
          Back
        </button>
      </div>
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}
