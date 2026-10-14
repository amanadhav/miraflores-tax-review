"use client";

import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";
import { parseRefs } from "@/components/finding-forms";

const input = "mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm";
const label = "block text-xs text-stone-500";
const primary = "rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50";
const secondary = "rounded border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50";

export type JudgmentKindOption = "judgment" | "election" | "due_diligence" | "penalty_decision";

export const KIND_GUIDANCE: Record<JudgmentKindOption, { label: string; guidance: string; authorityHint: string; conclusionHint: string }> = {
  judgment: {
    label: "Judgment call",
    guidance: "A judgment call records the authority relied on, how it applies to these facts, the conclusion reached and what follows from it. The evidence cited is what the conclusion rests on.",
    authorityHint: "Code section, regulation, ruling or form instructions relied on",
    conclusionHint: "What was decided, in plain words",
  },
  election: {
    label: "Election",
    guidance: "An election names the choice made and the alternative given up, for example section 179 expensing instead of special depreciation, and records its consequences in this year and later years.",
    authorityHint: "The provision that allows the election and how it is made",
    conclusionHint: "The choice made, and the alternative given up",
  },
  due_diligence: {
    label: "Due diligence",
    guidance: "Due diligence is a checklist: each requirement is one item, marked done or not, with the evidence that shows it. The record needs at least one item.",
    authorityHint: "For example IRC 6695(g) and the Form 8867 instructions",
    conclusionHint: "Whether the requirements were met and from what",
  },
  penalty_decision: {
    label: "Penalty decision",
    guidance: "A penalty decision states the method chosen (for example the annualized income installment method, a first-time abatement request, reasonable cause) and the reason for it.",
    authorityHint: "The code section or procedure for the method",
    conclusionHint: "The method and the reason it was chosen",
  },
};

interface ChecklistDraft {
  item: string;
  done: boolean;
  note: string;
}

export interface EvidenceOption {
  ref: string;
  label: string;
  found: boolean;
  available: boolean;
}

export interface JudgmentFormProps {
  revision: number;
  canRecord: boolean;
  actorRole: string;
  /** Fixed or default subject reference. */
  subjectRef?: string;
  subjectLabel?: string;
  lockSubject?: boolean;
  defaultKind?: JudgmentKindOption;
  defaultTitle?: string;
  /** The question this record answers; shown as context only, never written into the record. */
  question?: string;
  /** Evidence offered as checkboxes; unavailable or unresolved items cannot be chosen. */
  evidence?: EvidenceOption[];
  areas?: { id: string; label: string }[];
  defaultArea?: string;
  supersedesId?: string;
  /** Collapsed behind a small button until opened. */
  compact?: boolean;
  openLabel?: string;
}

/** Record a judgment call, election, due diligence record or penalty decision (command record_judgment). */
export function JudgmentForm(props: JudgmentFormProps) {
  const { send, pending, error, clearError } = useCommand(props.revision);
  const [open, setOpen] = useState(!props.compact);
  const [kind, setKind] = useState<JudgmentKindOption>(props.defaultKind ?? "judgment");
  const [subjectRef, setSubjectRef] = useState(props.subjectRef ?? "");
  const [title, setTitle] = useState(props.defaultTitle ?? "");
  const [authority, setAuthority] = useState("");
  const [applicability, setApplicability] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [consequences, setConsequences] = useState("");
  const [selected, setSelected] = useState<string[]>((props.evidence ?? []).filter((e) => e.found && e.available).map((e) => e.ref));
  const [extraRefs, setExtraRefs] = useState("");
  const [checklist, setChecklist] = useState<ChecklistDraft[]>([{ item: "", done: false, note: "" }]);
  const [area, setArea] = useState(props.defaultArea ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const g = KIND_GUIDANCE[kind];

  const toggle = (ref: string) => setSelected((cur) => (cur.includes(ref) ? cur.filter((r) => r !== ref) : [...cur, ref]));
  const setItem = (i: number, patch: Partial<ChecklistDraft>) => setChecklist((cur) => cur.map((c, k) => (k === i ? { ...c, ...patch } : c)));

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondary} onClick={() => setOpen(true)}>
          {props.openLabel ?? "Record judgment"}
        </button>
        {saved ? (
          <span className="text-xs text-emerald-700">
            Recorded <span className="num">{saved}</span>.
          </span>
        ) : null}
        {!props.canRecord ? <span className="text-xs text-stone-500">A {props.actorRole} cannot record judgments.</span> : null}
      </div>
    );
  }
  return (
    <form
      className="space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(null);
        const items = checklist.filter((c) => c.item.trim()).map((c) => ({ item: c.item.trim(), done: c.done, note: c.note.trim() || undefined }));
        const r = await send("record_judgment", {
          kind,
          subjectRef: subjectRef.trim(),
          title,
          authority,
          applicability,
          conclusion,
          consequences: consequences.trim() || undefined,
          evidenceRefs: [...new Set([...selected, ...parseRefs(extraRefs)])],
          checklist: kind === "due_diligence" ? items : items.length ? items : undefined,
          area: area || undefined,
          supersedesId: props.supersedesId,
        });
        if (r.ok) {
          setSaved((r.result as { judgmentId: string }).judgmentId);
          setTitle("");
          setAuthority("");
          setApplicability("");
          setConclusion("");
          setConsequences("");
          setChecklist([{ item: "", done: false, note: "" }]);
          if (props.compact) setOpen(false);
        }
      }}
    >
      {!props.canRecord ? <p className="text-xs text-amber-800">A {props.actorRole} cannot record judgments; the server will refuse this.</p> : null}
      {props.question ? <p className="rounded border border-stone-200 bg-white p-2 text-xs text-stone-700">{props.question}</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={label}>
          Kind
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value as JudgmentKindOption)}>
            {(Object.keys(KIND_GUIDANCE) as JudgmentKindOption[]).map((k) => (
              <option key={k} value={k}>
                {KIND_GUIDANCE[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Subject (line key, value id, document or household member)
          {props.lockSubject ? (
            <span className="mt-1 block text-sm text-stone-800">
              {props.subjectLabel ? `${props.subjectLabel} ` : ""}
              <span className="num text-stone-500">{subjectRef}</span>
            </span>
          ) : (
            <input className={`${input} num`} required value={subjectRef} onChange={(e) => setSubjectRef(e.target.value)} placeholder="Sch1.17" />
          )}
        </label>
      </div>
      <p className="text-xs text-stone-600">{g.guidance}</p>
      <label className={label}>
        Title
        <input className={input} required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className={label}>
        Authority
        <input className={input} required minLength={2} maxLength={2000} value={authority} onChange={(e) => setAuthority(e.target.value)} placeholder={g.authorityHint} />
      </label>
      <label className={label}>
        Applicability (how the authority applies to these facts)
        <textarea className={input} rows={2} required minLength={2} maxLength={4000} value={applicability} onChange={(e) => setApplicability(e.target.value)} />
      </label>
      {kind === "due_diligence" ? (
        <fieldset className="rounded border border-stone-200 bg-white p-2">
          <legend className="px-1 text-xs text-stone-500">Checklist (one requirement per row)</legend>
          <ul className="space-y-1">
            {checklist.map((c, i) => (
              <li key={i} className="grid gap-1 sm:grid-cols-[auto_2fr_2fr_auto] sm:items-center">
                <label className="flex items-center gap-1 text-xs text-stone-700">
                  <input type="checkbox" checked={c.done} onChange={(e) => setItem(i, { done: e.target.checked })} />
                  done
                </label>
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" value={c.item} onChange={(e) => setItem(i, { item: e.target.value })} placeholder="Requirement" />
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" value={c.note} onChange={(e) => setItem(i, { note: e.target.value })} placeholder="How it was met (optional)" maxLength={500} />
                <button type="button" className="text-xs text-stone-500 hover:underline" onClick={() => setChecklist((cur) => (cur.length > 1 ? cur.filter((_, k) => k !== i) : cur))}>
                  remove
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="mt-2 text-xs text-blue-700 hover:underline" onClick={() => setChecklist((cur) => [...cur, { item: "", done: false, note: "" }])}>
            Add a row
          </button>
        </fieldset>
      ) : null}
      <label className={label}>
        Conclusion
        <textarea className={input} rows={2} required minLength={2} maxLength={4000} value={conclusion} onChange={(e) => setConclusion(e.target.value)} placeholder={g.conclusionHint} />
      </label>
      <label className={label}>
        Consequences (optional: what changes on the return, in later years or for filings outside it)
        <textarea className={input} rows={2} maxLength={4000} value={consequences} onChange={(e) => setConsequences(e.target.value)} />
      </label>
      <fieldset>
        <legend className="text-xs text-stone-500">Evidence relied on</legend>
        {props.evidence && props.evidence.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {props.evidence.map((s) => (
              <li key={s.ref}>
                <label className={`flex items-start gap-2 text-xs ${s.found && s.available ? "text-stone-700" : "text-stone-400"}`}>
                  <input type="checkbox" className="mt-0.5" checked={selected.includes(s.ref)} disabled={!s.found || !s.available} onChange={() => toggle(s.ref)} />
                  <span>
                    {s.label} <span className="num text-stone-400">{s.ref}</span>
                    {!s.found ? " (unresolved)" : !s.available ? " (not yet available at the replay clock)" : ""}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
        <label className={`${label} mt-1`}>
          Additional references (comma separated)
          <input className={`${input} num`} value={extraRefs} onChange={(e) => setExtraRefs(e.target.value)} placeholder="D25, qa-25, reply:rpl_..." />
        </label>
      </fieldset>
      {props.areas && !props.lockSubject ? (
        <label className={label}>
          Area (optional; otherwise taken from the subject)
          <select className={input} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">From the subject</option>
            {props.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {props.supersedesId ? (
        <p className="text-xs text-stone-600">
          This record supersedes <span className="num">{props.supersedesId}</span>; the earlier one stays in the history as superseded.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving" : `Record ${g.label.toLowerCase()}`}
        </button>
        {props.compact ? (
          <button type="button" className={secondary} onClick={() => setOpen(false)}>
            Cancel
          </button>
        ) : null}
        {saved ? (
          <span className="text-xs text-emerald-700">
            Recorded <span className="num">{saved}</span>.
          </span>
        ) : null}
      </div>
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}
