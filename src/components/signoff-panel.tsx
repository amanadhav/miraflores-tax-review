"use client";

import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";
import { SignoffStatusBadge } from "@/components/line-value";
import { dateOnly } from "@/lib/format";
import type { SignoffPanelView } from "@/server/queries/review";

/**
 * Sign-offs for one scope (an area or a line) with the buttons to record and
 * withdraw them. The server enforces policy; this panel explains in plain
 * words why a button is expected to fail before it is pressed, and shows the
 * server's own message when it does.
 */
export function SignoffPanel({ panel, revision, title }: { panel: SignoffPanelView; revision: number; title?: string }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [note, setNote] = useState("");
  const [lastId, setLastId] = useState<string | null>(null);

  const sign = async (level: string) => {
    const r = await send("sign_off", { scopeType: panel.scopeType, scopeId: panel.scopeId, level, note: note.trim() || undefined });
    if (r.ok) {
      setLastId((r.result as { signoffId: string }).signoffId);
      setNote("");
    }
  };
  const withdraw = async (signoffId: string) => {
    const reason = window.prompt("Reason for withdrawing (optional)") ?? undefined;
    await send("withdraw_signoff", { signoffId, reason: reason?.trim() || undefined });
  };

  return (
    <div className="space-y-3">
      {title ? <h3 className="text-sm font-medium">{title}</h3> : null}
      {panel.signoffs.length === 0 ? (
        <p className="text-sm text-stone-500">No sign-offs recorded on {panel.scopeLabel}.</p>
      ) : (
        <ul className="divide-y divide-stone-100 text-sm">
          {panel.signoffs.map((s) => (
            <li key={s.id} id={s.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-1.5">
              <span className="w-16 font-medium capitalize">{s.level}</span>
              <SignoffStatusBadge status={s.status} />
              <span>
                {s.actor.name} <span className="text-xs text-stone-500">({s.actor.role})</span>
              </span>
              <span className="text-xs text-stone-500">
                revision <span className="num">{s.revision}</span>, {dateOnly(s.createdAt)}
                {s.mine ? ", you" : ""}
              </span>
              {s.canWithdraw ? (
                <button type="button" disabled={pending} onClick={() => void withdraw(s.id)} className="rounded border border-stone-300 bg-white px-2 py-0.5 text-xs hover:bg-stone-100 disabled:opacity-50">
                  Withdraw
                </button>
              ) : null}
              {s.note ? <span className="basis-full text-xs text-stone-600">Note: {s.note}</span> : null}
              {s.status === "stale" && s.invalidationReason ? (
                <span className="basis-full text-xs text-amber-800">{s.invalidationReason}</span>
              ) : s.status === "withdrawn" && s.invalidationReason ? (
                <span className="basis-full text-xs text-stone-500">
                  Withdrawn at revision <span className="num">{s.invalidatedRevision}</span>: {s.invalidationReason}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="rounded border border-stone-200 bg-stone-50 p-3">
        <label className="block text-xs text-stone-500">
          Sign-off note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm" placeholder="What was reviewed and relied on" />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {panel.capabilities.map((c) => (
            <button
              key={c.level}
              type="button"
              disabled={pending}
              onClick={() => void sign(c.level)}
              title={c.warning ?? `Record a ${c.level} sign-off on ${panel.scopeLabel}`}
              className={`rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${c.warning ? "border border-stone-300 bg-white text-stone-500 hover:bg-stone-100" : "bg-stone-900 text-white hover:bg-stone-700"}`}
            >
              Sign off as {c.level}
            </button>
          ))}
        </div>
        {panel.capabilities.some((c) => c.warning) ? (
          <ul className="mt-2 space-y-0.5 text-xs text-stone-500">
            {panel.capabilities
              .filter((c) => c.warning)
              .map((c) => (
                <li key={c.level}>
                  <span className="capitalize">{c.level}</span>: {c.warning}
                </li>
              ))}
          </ul>
        ) : null}
        <p className="mt-2 text-xs text-stone-400">
          A sign-off covers the values, evidence, open findings and upstream lines as they are now; it reopens automatically when any of them changes.
        </p>
        {lastId ? <p className="mt-1 text-xs text-emerald-700">Recorded sign-off {lastId}.</p> : null}
        <CommandErrorBox error={error} onDismiss={clearError} />
      </div>
    </div>
  );
}
