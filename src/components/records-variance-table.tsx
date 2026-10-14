"use client";

import Link from "next/link";
import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";
import { parseRefs } from "@/components/finding-forms";
import { formatLineValue, LineStatusBadge } from "@/components/line-value";
import { RecordLink } from "@/components/records-links";
import type { VarianceRowView } from "@/server/queries/records-a";

const input = "mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm";
const label = "block text-xs text-stone-500";
const primary = "rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50";
const secondary = "rounded border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50";

type Conclusion = "agrees" | "disagrees" | "unresolved";

function lineHref(key: string): string {
  return `/review/line/${encodeURIComponent(key)}`;
}

function signed(n: number | null): string {
  if (n === null) return "";
  const text = formatLineValue(Math.abs(n));
  return n < 0 ? `-${text}` : n > 0 ? `+${text}` : "0";
}

/** Explain one flagged line: a verification agreed to the prior year (command add_verification). */
function RowExplainForm({ row, revision, method, canVerify, actorRole, onClose }: { row: VarianceRowView; revision: number; method: string; canVerify: boolean; actorRole: string; onClose: () => void }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [conclusion, setConclusion] = useState<Conclusion>("agrees");
  const [note, setNote] = useState("");
  const [extra, setExtra] = useState("");
  const defaults = [row.priorRef, ...(row.priorSource && row.priorSource.found && row.priorSource.available ? [row.priorSource.ref] : [])];
  return (
    <form
      className="mt-2 space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send("add_verification", {
          subjectRef: row.key,
          method,
          evidenceRefs: [...new Set([...defaults, ...parseRefs(extra)])],
          conclusion,
          note: note.trim() || undefined,
        });
        if (r.ok) onClose();
      }}
    >
      <p className="text-xs text-stone-600">
        Explain <span className="font-medium">{row.label}</span> <span className="num text-stone-500">{row.key}</span>: 2024 <span className="num">{formatLineValue(row.prior)}</span> to 2025{" "}
        <span className="num">{formatLineValue(row.current)}</span>. Method {method.replace(/_/g, " ")}; evidence defaults to the 2024 return line{row.priorSource ? " and its extracted value" : ""}.
      </p>
      {!canVerify ? <p className="text-xs text-amber-800">A {actorRole} cannot record verifications; the server will refuse this.</p> : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={label}>
          Conclusion
          <select className={input} value={conclusion} onChange={(e) => setConclusion(e.target.value as Conclusion)}>
            <option value="agrees">Agrees: the change is explained</option>
            <option value="disagrees">Disagrees: the change looks wrong</option>
            <option value="unresolved">Unresolved: needs more work</option>
          </select>
        </label>
        <label className={`${label} sm:col-span-2`}>
          Why the line moved
          <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: second employer from June; two W-2s in 2025" />
        </label>
      </div>
      <label className={label}>
        Additional evidence (comma separated)
        <input className={`${input} num`} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="D09, qa-45" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving" : "Record explanation"}
        </button>
        <button type="button" className={secondary} onClick={onClose}>
          Cancel
        </button>
      </div>
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}

/**
 * Prior-year variance rows with a checkbox selection. "Explain selected"
 * records one batch_verify (agreed to prior year) for every selected line; the
 * per-row form records a single add_verification.
 */
export function VarianceTable({
  rows,
  revision,
  canVerify,
  actorRole,
  method,
  priorDocumentRef,
}: {
  rows: VarianceRowView[];
  revision: number;
  canVerify: boolean;
  actorRole: string;
  method: string;
  priorDocumentRef: string;
}) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [selected, setSelected] = useState<string[]>([]);
  const [conclusion, setConclusion] = useState<Conclusion>("agrees");
  const [note, setNote] = useState("");
  const [extra, setExtra] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const toggle = (key: string) => setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  const flaggedUnexplained = rows.filter((r) => r.flagged && !r.explained).map((r) => r.key);

  return (
    <div>
      <form
        className="mb-3 space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (selected.length === 0) return;
          const r = await send("batch_verify", {
            subjectRefs: selected,
            method,
            conclusion,
            evidenceRefs: [...new Set([priorDocumentRef, ...parseRefs(extra)])],
            note: note.trim() || undefined,
          });
          if (r.ok) {
            setSaved(`${selected.length} line(s) explained in batch ${(r.result as { batchId: string }).batchId}.`);
            setSelected([]);
            setNote("");
          }
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            Explain selected <span className="num font-normal text-stone-500">{selected.length}</span>
          </span>
          <button type="button" className={secondary} onClick={() => setSelected(flaggedUnexplained)} disabled={flaggedUnexplained.length === 0}>
            Select flagged and unexplained ({flaggedUnexplained.length})
          </button>
          <button type="button" className={secondary} onClick={() => setSelected([])} disabled={selected.length === 0}>
            Clear
          </button>
          {saved ? <span className="text-xs text-emerald-700">{saved}</span> : null}
          {!canVerify ? <span className="text-xs text-stone-500">A {actorRole} cannot record verifications.</span> : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className={label}>
            Conclusion
            <select className={input} value={conclusion} onChange={(e) => setConclusion(e.target.value as Conclusion)}>
              <option value="agrees">Agrees: explained by the 2024 return</option>
              <option value="disagrees">Disagrees</option>
              <option value="unresolved">Unresolved</option>
            </select>
          </label>
          <label className={label}>
            Note for every selected line
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was compared" />
          </label>
          <label className={label}>
            Evidence (2024 return {priorDocumentRef} plus any extra refs)
            <input className={`${input} num`} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="doc:D06#page1" />
          </label>
        </div>
        <div>
          <button type="submit" disabled={pending || selected.length === 0} className={primary}>
            {pending ? "Saving" : `Explain ${selected.length} selected by ${method.replace(/_/g, " ")}`}
          </button>
        </div>
        <CommandErrorBox error={error} onDismiss={clearError} />
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="px-2 py-2 font-normal"></th>
              <th className="px-3 py-2 font-normal">Line</th>
              <th className="px-3 py-2 text-right font-normal">2024</th>
              <th className="px-3 py-2 text-right font-normal">2025 effective</th>
              <th className="px-3 py-2 text-right font-normal">Change</th>
              <th className="px-3 py-2 text-right font-normal">Percent</th>
              <th className="px-3 py-2 font-normal">Flag</th>
              <th className="px-3 py-2 font-normal">Status</th>
              <th className="px-3 py-2 font-normal">Explained</th>
              <th className="px-3 py-2 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <RowGroup key={r.key} row={r} selected={selected.includes(r.key)} onToggle={() => toggle(r.key)} open={openRow === r.key} onOpen={() => setOpenRow(openRow === r.key ? null : r.key)} revision={revision} method={method} canVerify={canVerify} actorRole={actorRole} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowGroup({
  row,
  selected,
  onToggle,
  open,
  onOpen,
  revision,
  method,
  canVerify,
  actorRole,
}: {
  row: VarianceRowView;
  selected: boolean;
  onToggle: () => void;
  open: boolean;
  onOpen: () => void;
  revision: number;
  method: string;
  canVerify: boolean;
  actorRole: string;
}) {
  const tone = row.flagged ? (row.explained ? "bg-emerald-50/40" : "bg-amber-50/60") : "";
  return (
    <>
      <tr className={`border-t border-stone-100 align-top ${tone}`}>
        <td className="px-2 py-1.5">
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${row.key}`} />
        </td>
        <td className="px-3 py-1.5">
          <Link href={lineHref(row.key)} className="font-medium hover:underline">
            {row.label}
          </Link>
          <div className="num text-[11px] text-stone-500">
            {row.key}
            {row.line ? ` (${row.form} line ${row.line})` : ""}
          </div>
        </td>
        <td className="num px-3 py-1.5 text-right whitespace-nowrap text-stone-600">
          {row.priorSource ? <RecordLink refId={row.priorSource.ref} label={formatLineValue(row.prior)} className="num text-blue-700 hover:underline" /> : formatLineValue(row.prior)}
        </td>
        <td className="num px-3 py-1.5 text-right whitespace-nowrap">{formatLineValue(row.current)}</td>
        <td className="num px-3 py-1.5 text-right whitespace-nowrap">{signed(row.delta)}</td>
        <td className="num px-3 py-1.5 text-right whitespace-nowrap">{row.percent === null ? <span className="text-xs text-stone-400">no prior amount</span> : `${row.percent}%`}</td>
        <td className="px-3 py-1.5 text-xs">
          {row.flagged ? <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">flagged</span> : <span className="text-stone-400">under threshold</span>}
          <div className="mt-0.5 text-[11px] text-stone-500">{row.reason}</div>
        </td>
        <td className="px-3 py-1.5">{row.status ? <LineStatusBadge status={row.status} reason={row.statusReason ?? ""} /> : null}</td>
        <td className="px-3 py-1.5 text-xs">
          {row.explained ? (
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">explained</span>
          ) : row.flagged ? (
            <span className="rounded border border-amber-300 px-2 py-0.5 text-amber-800">not explained</span>
          ) : (
            <span className="text-stone-400">not needed</span>
          )}
          {row.explanations.map((v) => (
            <div key={v.id} className="mt-0.5 text-[11px] text-stone-500">
              {v.conclusion} by {v.actor.name} at revision <span className="num">{v.revision}</span>
              {v.note ? `: ${v.note}` : ""}
            </div>
          ))}
        </td>
        <td className="px-3 py-1.5">
          <button type="button" className={secondary} onClick={onOpen}>
            {open ? "Close" : "Explain"}
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="border-t border-stone-100">
          <td colSpan={10} className="px-3 pb-2">
            <RowExplainForm row={row} revision={revision} method={method} canVerify={canVerify} actorRole={actorRole} onClose={onOpen} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
