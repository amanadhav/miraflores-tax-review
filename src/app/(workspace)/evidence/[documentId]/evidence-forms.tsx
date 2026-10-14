"use client";

import { useEffect, useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";

type Tab = "anchor" | "verification" | "finding";

export interface EvidenceFormsProps {
  revision: number;
  documentId: string;
  page: number;
  pageRef: string;
  verificationTypes: string[];
  areas: { id: string; label: string }[];
  defaultArea: string;
  subjectSuggestions: { ref: string; label: string }[];
  permissions: { anchor: boolean; verification: boolean; finding: boolean };
  actorName: string;
}

const input = "mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm";
const label = "block text-xs text-stone-500";

/** Reads the browser selection when it lies inside the simulated page text. */
function useSelectionInPage(): string {
  const [selected, setSelected] = useState("");
  useEffect(() => {
    const onChange = () => {
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      const container = document.getElementById("source-page-text");
      if (!sel || !container || sel.isCollapsed) return;
      const node = sel.anchorNode;
      if (!node || !container.contains(node)) return;
      const text = sel.toString();
      if (text.trim().length >= 2) setSelected(text);
    };
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("mouseup", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("mouseup", onChange);
    };
  }, []);
  return selected;
}

function splitRefs(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function EvidenceForms(props: EvidenceFormsProps) {
  const [tab, setTab] = useState<Tab>("anchor");
  const tabs: { id: Tab; label: string; allowed: boolean }[] = [
    { id: "anchor", label: "Add anchor", allowed: props.permissions.anchor },
    { id: "verification", label: "Record verification", allowed: props.permissions.verification },
    { id: "finding", label: "Raise finding", allowed: props.permissions.finding },
  ];
  return (
    <section className="rounded-lg border border-stone-200 bg-white">
      <div className="flex flex-wrap gap-1 border-b border-stone-200 px-3 pt-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-t px-3 py-1.5 text-sm ${tab === t.id ? "border border-b-0 border-stone-200 bg-white font-medium" : "text-stone-600 hover:text-stone-900"}`}
          >
            {t.label}
            {!t.allowed ? <span className="ml-1 text-xs text-stone-400">(not allowed for {props.actorName})</span> : null}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === "anchor" ? <AnchorForm {...props} /> : tab === "verification" ? <VerificationForm {...props} /> : <FindingForm {...props} />}
      </div>
      <datalist id="subject-suggestions">
        {props.subjectSuggestions.map((s) => (
          <option key={s.ref} value={s.ref}>
            {s.label}
          </option>
        ))}
      </datalist>
    </section>
  );
}

function AnchorForm(props: EvidenceFormsProps) {
  const { send, pending, error, clearError } = useCommand(props.revision);
  const selected = useSelectionInPage();
  const [subjectRef, setSubjectRef] = useState(props.subjectSuggestions[0]?.ref ?? "");
  const [typed, setTyped] = useState("");
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  // Until the reviewer types, the field mirrors whatever is selected on the simulated page.
  const textSpan = dirty ? typed : selected;
  const setTextSpan = (value: string) => {
    setTyped(value);
    setDirty(true);
  };
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(null);
        const r = await send("add_anchor", { subjectRef: subjectRef.trim(), documentId: props.documentId, page: props.page, textSpan, note: note || undefined });
        if (r.ok) {
          setSaved(`Anchor saved at revision ${r.revision}.`);
          setTyped("");
          setDirty(true);
          setNote("");
        }
      }}
    >
      <p className="text-xs text-stone-500">
        An anchor quotes the exact printed text that supports a line, a value or a change. Select text on the simulated page to prefill it, or paste
        it; the server refuses anything that is not printed on this page verbatim.
      </p>
      <div>
        <label className={label} htmlFor="anchor-subject">
          Supports (line key, extracted value id or adjustment id)
        </label>
        <input id="anchor-subject" list="subject-suggestions" value={subjectRef} onChange={(e) => setSubjectRef(e.target.value)} className={`num ${input}`} required />
      </div>
      <div>
        <label className={label} htmlFor="anchor-text">
          Exact text on page {props.page}
        </label>
        <textarea id="anchor-text" value={textSpan} onChange={(e) => setTextSpan(e.target.value)} rows={2} className={input} required minLength={2} />
        {selected && selected !== textSpan ? (
          <button type="button" className="mt-1 text-xs text-blue-700 hover:underline" onClick={() => setTextSpan(selected)}>
            Use selected text: &quot;{selected.length > 60 ? `${selected.slice(0, 60)}...` : selected}&quot;
          </button>
        ) : null}
      </div>
      <div>
        <label className={label} htmlFor="anchor-note">
          Note (optional)
        </label>
        <input id="anchor-note" value={note} onChange={(e) => setNote(e.target.value)} className={input} maxLength={1000} />
      </div>
      <button type="submit" disabled={pending || !props.permissions.anchor} className="rounded bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">
        {pending ? "Saving" : "Add anchor"}
      </button>
      {saved ? <p className="text-xs text-emerald-700">{saved}</p> : null}
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}

function VerificationForm(props: EvidenceFormsProps) {
  const { send, pending, error, clearError } = useCommand(props.revision);
  const [subjectRef, setSubjectRef] = useState(props.subjectSuggestions[0]?.ref ?? "");
  const [method, setMethod] = useState(props.verificationTypes[0] ?? "");
  const [evidence, setEvidence] = useState(props.pageRef);
  const [conclusion, setConclusion] = useState<"agrees" | "disagrees" | "unresolved">("agrees");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(null);
        const r = await send("add_verification", { subjectRef: subjectRef.trim(), method, evidenceRefs: splitRefs(evidence), conclusion, note: note || undefined });
        if (r.ok) {
          setSaved(`Verification saved at revision ${r.revision}.`);
          setNote("");
        }
      }}
    >
      <div>
        <label className={label} htmlFor="ver-subject">
          Subject (line key, extracted value id or adjustment id)
        </label>
        <input id="ver-subject" list="subject-suggestions" value={subjectRef} onChange={(e) => setSubjectRef(e.target.value)} className={`num ${input}`} required />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="ver-method">
            Method (firm standard)
          </label>
          <select id="ver-method" value={method} onChange={(e) => setMethod(e.target.value)} className={`${input} bg-white`}>
            {props.verificationTypes.map((v) => (
              <option key={v} value={v}>
                {v.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="ver-conclusion">
            Conclusion
          </label>
          <select id="ver-conclusion" value={conclusion} onChange={(e) => setConclusion(e.target.value as typeof conclusion)} className={`${input} bg-white`}>
            <option value="agrees">agrees</option>
            <option value="disagrees">disagrees</option>
            <option value="unresolved">unresolved</option>
          </select>
        </div>
      </div>
      <div>
        <label className={label} htmlFor="ver-evidence">
          Evidence references (comma or space separated)
        </label>
        <input id="ver-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} className={`num ${input}`} />
      </div>
      <div>
        <label className={label} htmlFor="ver-note">
          Note (optional)
        </label>
        <input id="ver-note" value={note} onChange={(e) => setNote(e.target.value)} className={input} maxLength={2000} />
      </div>
      <button type="submit" disabled={pending || !props.permissions.verification} className="rounded bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">
        {pending ? "Saving" : "Record verification"}
      </button>
      {saved ? <p className="text-xs text-emerald-700">{saved}</p> : null}
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}

function FindingForm(props: EvidenceFormsProps) {
  const { send, pending, error, clearError } = useCommand(props.revision);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [severity, setSeverity] = useState<"info" | "warning" | "blocker">("warning");
  const [refs, setRefs] = useState(props.pageRef);
  const [area, setArea] = useState(props.defaultArea);
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(null);
        const r = await send("raise_finding", { title, detail, severity, refs: splitRefs(refs), area });
        if (r.ok) {
          setSaved(`Finding raised at revision ${r.revision}.`);
          setTitle("");
          setDetail("");
        }
      }}
    >
      <div>
        <label className={label} htmlFor="fnd-title">
          Title
        </label>
        <input id="fnd-title" value={title} onChange={(e) => setTitle(e.target.value)} className={input} required minLength={3} maxLength={200} />
      </div>
      <div>
        <label className={label} htmlFor="fnd-detail">
          Detail
        </label>
        <textarea id="fnd-detail" value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} className={input} required minLength={3} maxLength={4000} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="fnd-severity">
            Severity (warning and blocker block filing)
          </label>
          <select id="fnd-severity" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} className={`${input} bg-white`}>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="blocker">blocker</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="fnd-area">
            Review area
          </label>
          <select id="fnd-area" value={area} onChange={(e) => setArea(e.target.value)} className={`${input} bg-white`}>
            {props.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className={label} htmlFor="fnd-refs">
          References (comma or space separated)
        </label>
        <input id="fnd-refs" value={refs} onChange={(e) => setRefs(e.target.value)} className={`num ${input}`} />
      </div>
      <button type="submit" disabled={pending || !props.permissions.finding} className="rounded bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">
        {pending ? "Saving" : "Raise finding"}
      </button>
      {saved ? <p className="text-xs text-emerald-700">{saved}</p> : null}
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}
