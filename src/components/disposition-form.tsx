"use client";

import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";

const input = "rounded border border-stone-300 bg-white px-2 py-1 text-xs";
const primary = "rounded bg-stone-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50";

/**
 * Area applicability: record whether a review area applies to this return
 * (command record_disposition on area:<id>, "used" for applies and
 * "not_applicable" otherwise). The note says why.
 */
export function AreaApplicabilityForm({ areaId, areaLabel, revision, canRecord, current }: { areaId: string; areaLabel: string; revision: number; canRecord: boolean; current: boolean | null }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [choice, setChoice] = useState<"applies" | "not_applicable">(current === false ? "not_applicable" : "applies");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        const r = await send("record_disposition", {
          subjectRef: `area:${areaId}`,
          disposition: choice === "applies" ? "used" : "not_applicable",
          note: note.trim() || undefined,
        });
        if (r.ok) {
          setSaved(true);
          setNote("");
        }
      }}
    >
      <select className={input} value={choice} onChange={(e) => setChoice(e.target.value as "applies" | "not_applicable")} aria-label={`Does ${areaLabel} apply`} disabled={!canRecord}>
        <option value="applies">Applies</option>
        <option value="not_applicable">Not applicable</option>
      </select>
      <input className={`${input} w-56`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional)" maxLength={2000} disabled={!canRecord} />
      <button type="submit" disabled={pending || !canRecord} className={primary} title={canRecord ? undefined : "Not allowed for this person"}>
        {pending ? "Saving" : current === null ? "Record" : "Update"}
      </button>
      {saved ? <span className="text-xs text-emerald-700">Recorded.</span> : null}
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}

/** One disposition on a document or page (command record_disposition). */
export function DispositionForm({ subjectRef, revision, canRecord, options }: { subjectRef: string; revision: number; canRecord: boolean; options: { value: string; label: string }[] }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [disposition, setDisposition] = useState(options[0]?.value ?? "reviewed_no_use");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        const r = await send("record_disposition", { subjectRef, disposition, note: note.trim() || undefined });
        if (r.ok) {
          setSaved(true);
          setNote("");
        }
      }}
    >
      <select className={input} value={disposition} onChange={(e) => setDisposition(e.target.value)} disabled={!canRecord} aria-label={`Disposition for ${subjectRef}`}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input className={`${input} w-48`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={2000} disabled={!canRecord} />
      <button type="submit" disabled={pending || !canRecord} className={primary}>
        {pending ? "Saving" : "Record"}
      </button>
      {saved ? <span className="text-xs text-emerald-700">Recorded.</span> : null}
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}
