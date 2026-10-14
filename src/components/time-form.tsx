"use client";

import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";

const input = "mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm";
const label = "block text-xs text-stone-500";
const primary = "rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50";

/** Log hours against a review area (command log_time). The date defaults to the replay clock. */
export function LogTimeForm({ revision, canLog, actorRole, areas, defaultDate, defaultArea }: { revision: number; canLog: boolean; actorRole: string; areas: { id: string; label: string }[]; defaultDate: string; defaultArea?: string }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [area, setArea] = useState(defaultArea ?? areas[0]?.id ?? "");
  const [hours, setHours] = useState("1");
  const [workDate, setWorkDate] = useState(defaultDate);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(null);
        const n = Number(hours);
        const r = await send("log_time", { area, hours: n, workDate, note: note.trim() || undefined });
        if (r.ok) {
          setSaved(`${n} h logged on ${workDate}.`);
          setNote("");
        }
      }}
    >
      {!canLog ? <p className="text-xs text-amber-800">A {actorRole} cannot log time; the server will refuse this.</p> : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={label}>
          Area
          <select className={input} value={area} onChange={(e) => setArea(e.target.value)}>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Hours (up to 24, quarter hours)
          <input type="number" className={`${input} num`} min={0.25} max={24} step={0.25} required value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <label className={label}>
          Date (defaults to the replay clock)
          <input type="date" className={`${input} num`} required value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
        </label>
      </div>
      <label className={label}>
        Note (optional)
        <input className={input} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the time went on" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving" : "Log time"}
        </button>
        {saved ? <span className="text-xs text-emerald-700">{saved}</span> : null}
      </div>
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}
