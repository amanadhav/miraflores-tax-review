"use client";

import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";
import { parseRefs } from "@/components/finding-forms";
import { RecordLink } from "@/components/records-links";
import type { VerifyTarget } from "@/server/queries/records-a";

const input = "mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm";
const label = "block text-xs text-stone-500";
const primary = "rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50";
const secondary = "rounded border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50";

type Conclusion = "agrees" | "disagrees" | "unresolved";

/**
 * Record that a payments line was agreed to the agency's own record
 * (command add_verification, method agreed_to_third_party_record). The
 * evidence defaults to the agency record and the payment confirmations.
 */
export function ThirdPartyVerifyForm({ target, revision, canVerify, actorRole }: { target: VerifyTarget; revision: number; canVerify: boolean; actorRole: string }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [open, setOpen] = useState(false);
  const [conclusion, setConclusion] = useState<Conclusion>("agrees");
  const [note, setNote] = useState("");
  const [extra, setExtra] = useState("");
  const [selected, setSelected] = useState<string[]>(target.evidenceRefs.filter((r) => r.found && r.available).map((r) => r.ref));
  const [saved, setSaved] = useState<string | null>(null);
  const toggle = (ref: string) => setSelected((cur) => (cur.includes(ref) ? cur.filter((r) => r !== ref) : [...cur, ref]));

  return (
    <div>
      {target.existing.length > 0 ? (
        <ul className="mb-2 space-y-1 text-xs">
          {target.existing.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 ${v.conclusion === "agrees" ? "bg-emerald-100 text-emerald-800" : v.conclusion === "disagrees" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{v.conclusion}</span>
              <span>{v.methodLabel}</span>
              <span className="text-stone-500">
                {v.actor.name}, revision <span className="num">{v.revision}</span>
                {v.note ? `: ${v.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-xs text-stone-400">Not yet agreed to the agency record.</p>
      )}
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={secondary} onClick={() => setOpen(true)}>
            Record: agreed to third-party record for <span className="num">{target.subjectRef}</span>
          </button>
          {saved ? <span className="text-xs text-emerald-700">Recorded verification {saved}.</span> : null}
          {!canVerify ? <span className="text-xs text-stone-500">A {actorRole} cannot record verifications.</span> : null}
        </div>
      ) : (
        <form
          className="space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await send("add_verification", {
              subjectRef: target.subjectRef,
              method: target.method,
              evidenceRefs: [...new Set([...selected, ...parseRefs(extra)])],
              conclusion,
              note: note.trim() || undefined,
            });
            if (r.ok) {
              setSaved((r.result as { verificationId: string }).verificationId);
              setNote("");
              setOpen(false);
            }
          }}
        >
          <p className="text-xs text-stone-600">
            {target.subjectLabel} <span className="num text-stone-500">{target.subjectRef}</span>, method {target.method.replace(/_/g, " ")}.
          </p>
          {!canVerify ? <p className="text-xs text-amber-800">A {actorRole} cannot record verifications; the server will refuse this.</p> : null}
          <fieldset>
            <legend className="text-xs text-stone-500">Agency record and confirmations checked</legend>
            <ul className="mt-1 space-y-0.5">
              {target.evidenceRefs.map((r) => (
                <li key={r.ref}>
                  <label className={`flex items-start gap-2 text-xs ${r.found && r.available ? "text-stone-700" : "text-stone-400"}`}>
                    <input type="checkbox" className="mt-0.5" checked={selected.includes(r.ref)} disabled={!r.found || !r.available} onChange={() => toggle(r.ref)} />
                    <span>
                      <RecordLink refId={r.ref} label={r.label} className="text-xs text-blue-700 hover:underline" /> <span className="num text-stone-400">{r.ref}</span>
                      {!r.available ? " (not yet available at the replay clock)" : ""}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={label}>
              Conclusion
              <select className={input} value={conclusion} onChange={(e) => setConclusion(e.target.value as Conclusion)}>
                <option value="agrees">Agrees with the agency record</option>
                <option value="disagrees">Disagrees: the return and the record differ</option>
                <option value="unresolved">Unresolved</option>
              </select>
            </label>
            <label className={label}>
              Additional references (comma separated)
              <input className={`${input} num`} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="qa-41" />
            </label>
          </div>
          <label className={label}>
            Note
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was compared and any difference noted" />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={primary}>
              {pending ? "Saving" : "Record verification"}
            </button>
            <button type="button" className={secondary} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <CommandErrorBox error={error} onDismiss={clearError} />
        </form>
      )}
    </div>
  );
}
