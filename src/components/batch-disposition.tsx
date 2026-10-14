"use client";

import Link from "next/link";
import { useState } from "react";
import { CommandButton, CommandErrorBox, useCommand } from "@/components/command-client";
import { dateOnly } from "@/lib/format";
import type { BatchView, CompletenessDoc, DocStatus, DispositionView, PageRow } from "@/server/queries/completeness";

const input = "rounded border border-stone-300 bg-white px-2 py-1 text-xs";
const primary = "rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50";
const secondary = "rounded border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50";

export function DocStatusBadge({ status, label }: { status: DocStatus; label: string }) {
  const tone =
    status === "used"
      ? "bg-emerald-100 text-emerald-800"
      : status === "superseded"
        ? "bg-amber-100 text-amber-800"
        : status === "dispositioned"
          ? "bg-blue-100 text-blue-800"
          : status === "not_yet_available"
            ? "bg-stone-200 text-stone-700"
            : "bg-rose-100 text-rose-800";
  return <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${tone}`}>{label}</span>;
}

function DispositionCell({ d }: { d: DispositionView | null }) {
  if (!d) return <span className="text-xs text-stone-400">none</span>;
  return (
    <div className="text-xs">
      <span className="font-medium">{d.label}</span>
      <span className="text-stone-500">
        {" "}
        by {d.actor.name}, revision <span className="num">{d.createdRevision}</span>
        {d.batchId ? " (batch)" : ""}
      </span>
      {d.note ? <div className="text-stone-600">{d.note}</div> : null}
    </div>
  );
}

/**
 * The document and page tables with a multi-select and one batch action
 * (command batch_disposition). The whole batch succeeds or fails together and
 * can be undone as one unit while nobody else has worked on the same items.
 */
export function CompletenessTable({
  documents,
  pages,
  revision,
  canRecord,
  actorRole,
  dispositions,
}: {
  documents: CompletenessDoc[];
  pages: PageRow[];
  revision: number;
  canRecord: boolean;
  actorRole: string;
  dispositions: { value: string; label: string }[];
}) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [selected, setSelected] = useState<string[]>([]);
  const [disposition, setDisposition] = useState("reviewed_no_use");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  const selectable = [...documents.filter((d) => d.available).map((d) => d.ref), ...pages.filter((p) => p.available).map((p) => p.ref)];
  const toggle = (ref: string) => setSelected((cur) => (cur.includes(ref) ? cur.filter((r) => r !== ref) : [...cur, ref]));
  const selectUnaccounted = () => setSelected(documents.filter((d) => d.status === "unaccounted").map((d) => d.ref));

  return (
    <div className="space-y-4">
      <form
        className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded border border-stone-200 bg-stone-50 p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaved(null);
          const r = await send("batch_disposition", { subjectRefs: selected, disposition, note: note.trim() || undefined });
          if (r.ok) {
            const res = r.result as { batchId: string; count: number };
            setSaved(`${res.count} item(s) marked in batch ${res.batchId}.`);
            setSelected([]);
            setNote("");
          }
        }}
      >
        <span className="text-xs text-stone-600">
          <span className="num font-medium">{selected.length}</span> selected
        </span>
        <button type="button" className={secondary} onClick={selectUnaccounted}>
          Select all unaccounted
        </button>
        <button type="button" className={secondary} onClick={() => setSelected(selectable)}>
          Select all shown
        </button>
        <button type="button" className={secondary} onClick={() => setSelected([])}>
          Clear
        </button>
        <select className={input} value={disposition} onChange={(e) => setDisposition(e.target.value)} aria-label="Disposition for the selected items">
          {dispositions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input className={`${input} w-64`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the whole batch (optional)" maxLength={2000} />
        <button type="submit" disabled={pending || selected.length === 0 || !canRecord} className={primary}>
          {pending ? "Saving" : `Apply to ${selected.length} selected`}
        </button>
        {!canRecord ? <span className="text-xs text-stone-500">A {actorRole} cannot record dispositions.</span> : null}
        {saved ? <span className="text-xs text-emerald-700">{saved}</span> : null}
        <div className="basis-full">
          <CommandErrorBox error={error} onDismiss={clearError} />
        </div>
      </form>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Documents</h2>
          <span className="text-xs text-stone-500">{documents.length} shown</span>
        </div>
        {documents.length === 0 ? (
          <p className="px-5 py-3 text-sm text-stone-500">No documents match these filters.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2 font-normal" />
                <th className="px-2 py-2 font-normal">Document</th>
                <th className="px-2 py-2 font-normal">Type</th>
                <th className="px-2 py-2 font-normal">Received</th>
                <th className="px-2 py-2 font-normal">Area</th>
                <th className="px-2 py-2 font-normal">Status at the clock</th>
                <th className="px-2 py-2 font-normal">Disposition in force</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id} className={`border-t border-stone-100 align-top ${d.available ? "" : "text-stone-500"} ${selected.includes(d.ref) ? "bg-amber-50" : ""}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.includes(d.ref)} disabled={!d.available} onChange={() => toggle(d.ref)} aria-label={`Select ${d.id}`} />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="num text-xs text-stone-500">{d.id}</span>
                      {d.available ? (
                        <Link href={`/evidence/${d.id}`} className="font-medium hover:underline">
                          {d.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{d.title}</span>
                      )}
                    </div>
                    <div className="text-xs text-stone-500">{d.issuer}</div>
                    {d.supersededBy ? (
                      <div className="text-xs text-amber-800">
                        Superseded by <span className="num">{d.supersededBy}</span>
                      </div>
                    ) : null}
                    {d.pagesWithoutValues.length > 0 ? (
                      <div className="text-xs text-amber-800">
                        Partially extracted: page{d.pagesWithoutValues.length === 1 ? "" : "s"} <span className="num">{d.pagesWithoutValues.join(", ")}</span> read nothing
                        {d.statedEmptyPages > 0 ? <span className="text-stone-500">; {d.statedEmptyPages} further page(s) print only a nothing-further statement</span> : null}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">{d.typeLabel}</td>
                  <td className="num px-2 py-2 whitespace-nowrap">{d.available ? dateOnly(d.receivedAt) : <span className="text-amber-800">arrives {dateOnly(d.receivedAt)}</span>}</td>
                  <td className="px-2 py-2 text-xs">{d.areaLabel}</td>
                  <td className="px-2 py-2">
                    <DocStatusBadge status={d.status} label={d.statusLabel} />
                  </td>
                  <td className="px-2 py-2">
                    <DispositionCell d={d.disposition} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Pages the pipeline read nothing from</h2>
          <p className="mt-0.5 text-xs text-stone-500">
            A partially extracted document has pages with no extracted value. Each needs a look: a value that landed nowhere is a gap. Open the page on the Evidence screen to read and anchor it, then record what it holds.
          </p>
        </div>
        {pages.length === 0 ? (
          <p className="px-5 py-3 text-sm text-stone-500">No partially extracted documents in this view.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2 font-normal" />
                <th className="px-2 py-2 font-normal">Page</th>
                <th className="px-2 py-2 font-normal">Document</th>
                <th className="px-2 py-2 font-normal">Disposition in force</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.ref} className={`border-t border-stone-100 align-top ${selected.includes(p.ref) ? "bg-amber-50" : ""}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.includes(p.ref)} disabled={!p.available} onChange={() => toggle(p.ref)} aria-label={`Select ${p.ref}`} />
                  </td>
                  <td className="px-2 py-2">
                    {p.available ? (
                      <Link href={p.href} className="num text-blue-700 hover:underline">
                        {p.ref}
                      </Link>
                    ) : (
                      <span className="num text-stone-500">{p.ref}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <span className="num text-xs text-stone-500">{p.documentId}</span> {p.title}
                  </td>
                  <td className="px-2 py-2">
                    <DispositionCell d={p.disposition} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** Batches still in force with an Undo for the ones the viewer may reverse (command undo_batch). */
export function BatchList({ batches, revision }: { batches: BatchView[]; revision: number }) {
  if (batches.length === 0) return <p className="text-sm text-stone-500">No batch dispositions are in force.</p>;
  return (
    <ul className="divide-y divide-stone-100 text-sm">
      {batches.map((b) => (
        <li key={b.batchId} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
          <span className="num text-xs text-stone-500">{b.batchId}</span>
          <span className="font-medium">{b.label}</span>
          <span className="text-xs text-stone-500">
            {b.subjects.length} item(s) by {b.actor.name}
            {b.mine ? " (you)" : ""}, revision <span className="num">{b.createdRevision}</span>, {dateOnly(b.createdAt)}
          </span>
          {b.canUndo ? (
            <CommandButton
              revision={revision}
              type="undo_batch"
              payload={{ batchId: b.batchId }}
              confirm={`Undo batch ${b.batchId}? Every disposition it recorded is withdrawn. The server refuses if a colleague has since worked on any of the same items.`}
            >
              Undo batch
            </CommandButton>
          ) : null}
          {b.note ? <span className="basis-full text-xs text-stone-600">Note: {b.note}</span> : null}
          <span className="num basis-full text-[11px] text-stone-400">{b.subjects.join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}
