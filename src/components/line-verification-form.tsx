"use client";

import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";
import { parseRefs } from "@/components/finding-forms";
import type { RefView } from "@/server/queries/review";

const input = "mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm";
const label = "block text-xs text-stone-500";

/** Record a verification of one line (command add_verification). */
export function LineVerificationForm({
  subjectRef,
  revision,
  methods,
  sources,
  canVerify,
  actorRole,
}: {
  subjectRef: string;
  revision: number;
  methods: string[];
  sources: RefView[];
  canVerify: boolean;
  actorRole: string;
}) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState(methods[0] ?? "");
  const [selected, setSelected] = useState<string[]>(sources.filter((s) => s.found && s.available).map((s) => s.ref));
  const [extraRefs, setExtraRefs] = useState("");
  const [conclusion, setConclusion] = useState<"agrees" | "disagrees" | "unresolved">("agrees");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  const toggle = (ref: string) => setSelected((cur) => (cur.includes(ref) ? cur.filter((r) => r !== ref) : [...cur, ref]));

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="rounded border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-100" onClick={() => setOpen(true)}>
          Add verification
        </button>
        {saved ? <span className="text-xs text-emerald-700">Recorded verification {saved}.</span> : null}
        {!canVerify ? <span className="text-xs text-stone-500">A {actorRole} cannot record verifications.</span> : null}
      </div>
    );
  }
  return (
    <form
      className="space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send("add_verification", {
          subjectRef,
          method,
          evidenceRefs: [...new Set([...selected, ...parseRefs(extraRefs)])],
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
      {!canVerify ? <p className="text-xs text-amber-800">A {actorRole} cannot record verifications; the server will refuse this.</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={label}>
          Method (firm standard)
          <select className={input} value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Conclusion
          <select className={input} value={conclusion} onChange={(e) => setConclusion(e.target.value as "agrees" | "disagrees" | "unresolved")}>
            <option value="agrees">Agrees with the evidence</option>
            <option value="disagrees">Disagrees with the evidence</option>
            <option value="unresolved">Unresolved</option>
          </select>
        </label>
      </div>
      <fieldset>
        <legend className="text-xs text-stone-500">Evidence checked (defaults to the line&apos;s sources)</legend>
        <ul className="mt-1 space-y-0.5">
          {sources.map((s) => (
            <li key={s.ref}>
              <label className={`flex items-start gap-2 text-xs ${s.found && s.available ? "text-stone-700" : "text-stone-400"}`}>
                <input type="checkbox" className="mt-0.5" checked={selected.includes(s.ref)} disabled={!s.found || !s.available} onChange={() => toggle(s.ref)} />
                <span>
                  {s.label} <span className="num text-stone-400">{s.ref}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <label className={`${label} mt-2`}>
          Additional references (comma separated)
          <input className={`${input} num`} value={extraRefs} onChange={(e) => setExtraRefs(e.target.value)} placeholder="doc:D15#page3, qa-14" />
        </label>
      </fieldset>
      <label className={label}>
        Note (optional)
        <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was compared and any difference noted" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50">
          {pending ? "Saving" : "Record verification"}
        </button>
        <button type="button" className="rounded border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-100" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}
