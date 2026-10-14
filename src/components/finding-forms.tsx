"use client";

import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";

const input = "mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm";
const label = "block text-xs text-stone-500";
const primary = "rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50";
const secondary = "rounded border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50";

/** Split a free-text list of references on commas, whitespace or newlines. */
export function parseRefs(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

/** Resolve or dismiss an open finding (command resolve_finding). */
export function ResolveFindingForm({ findingId, revision, canResolve, actorRole }: { findingId: string; revision: number; canResolve: boolean; actorRole: string }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<"resolved" | "dismissed">("resolved");
  const [resolution, setResolution] = useState("");
  const [refs, setRefs] = useState("");
  const [done, setDone] = useState<string | null>(null);

  if (done) return <p className="mt-2 text-xs text-emerald-700">Finding {done}.</p>;
  if (!open) {
    return (
      <div className="mt-2">
        <button type="button" className={secondary} onClick={() => setOpen(true)}>
          Resolve or dismiss
        </button>
        {!canResolve ? <span className="ml-2 text-xs text-stone-500">A {actorRole} cannot resolve findings; the server will refuse this.</span> : null}
      </div>
    );
  }
  return (
    <form
      className="mt-2 space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send("resolve_finding", { findingId, outcome, resolution, evidenceRefs: parseRefs(refs) });
        if (r.ok) setDone(outcome);
      }}
    >
      {!canResolve ? <p className="text-xs text-amber-800">A {actorRole} cannot resolve findings; the server will refuse this.</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={label}>
          Outcome
          <select className={input} value={outcome} onChange={(e) => setOutcome(e.target.value as "resolved" | "dismissed")}>
            <option value="resolved">Resolved (the issue was fixed or substantiated)</option>
            <option value="dismissed">Dismissed (not an issue after review)</option>
          </select>
        </label>
        <label className={label}>
          Evidence references (optional; comma separated, for example doc:D15#page3, call-01)
          <input className={`${input} num`} value={refs} onChange={(e) => setRefs(e.target.value)} placeholder="doc:D15#page3, ev-0103" />
        </label>
      </div>
      <label className={label}>
        Resolution
        <textarea className={input} rows={2} required minLength={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What was checked and why this is settled" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving" : outcome === "resolved" ? "Mark resolved" : "Dismiss"}
        </button>
        <button type="button" className={secondary} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}

/** Raise a reviewer finding in an area (command raise_finding). */
export function RaiseFindingForm({
  areaId,
  areaLabel,
  revision,
  canRaise,
  actorRole,
  owners,
  defaultRefs = [],
}: {
  areaId: string;
  areaLabel: string;
  revision: number;
  canRaise: boolean;
  actorRole: string;
  owners: { id: string; name: string; role: string }[];
  defaultRefs?: string[];
}) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [severity, setSeverity] = useState<"info" | "warning" | "blocker">("warning");
  const [refs, setRefs] = useState(defaultRefs.join(", "));
  const [blocks, setBlocks] = useState(true);
  const [ownerId, setOwnerId] = useState("");
  const [raised, setRaised] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondary} onClick={() => setOpen(true)}>
          Raise a finding
        </button>
        {raised ? <span className="text-xs text-emerald-700">Finding {raised} raised.</span> : null}
        {!canRaise ? <span className="text-xs text-stone-500">A {actorRole} cannot raise findings.</span> : null}
      </div>
    );
  }
  return (
    <form
      className="space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send("raise_finding", {
          title,
          detail,
          severity,
          refs: parseRefs(refs),
          area: areaId,
          blocksFiling: blocks,
          ownerId: ownerId || undefined,
        });
        if (r.ok) {
          setRaised((r.result as { findingId: string }).findingId);
          setTitle("");
          setDetail("");
          setOpen(false);
        }
      }}
    >
      <p className="text-xs text-stone-500">New finding in {areaLabel}.</p>
      {!canRaise ? <p className="text-xs text-amber-800">A {actorRole} cannot raise findings; the server will refuse this.</p> : null}
      <label className={label}>
        Title
        <input className={input} required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className={label}>
        Detail
        <textarea className={input} rows={3} required minLength={3} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="What is wrong or unverified, and what would settle it" />
      </label>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={label}>
          Severity
          <select
            className={input}
            value={severity}
            onChange={(e) => {
              const s = e.target.value as "info" | "warning" | "blocker";
              setSeverity(s);
              setBlocks(s !== "info");
            }}
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="blocker">Blocker</option>
          </select>
        </label>
        <label className={label}>
          Owner
          <select className={input} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Assigned preparer (default)</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.role})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-1.5 text-xs text-stone-700">
          <input type="checkbox" checked={blocks} onChange={(e) => setBlocks(e.target.checked)} />
          Blocks filing until resolved
        </label>
      </div>
      <label className={label}>
        References (comma separated: line keys such as SchC.25, evidence such as doc:D15#page3, ev-0103, call-01)
        <input className={`${input} num`} value={refs} onChange={(e) => setRefs(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving" : "Raise finding"}
        </button>
        <button type="button" className={secondary} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}
