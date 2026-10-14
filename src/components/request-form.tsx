"use client";

import Link from "next/link";
import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";
import { parseRefs } from "@/components/finding-forms";

const input = "mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm";
const label = "block text-xs text-stone-500";
const primary = "rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50";
const secondary = "rounded border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50";

type Kind = "client_question" | "document_request" | "colleague_question";

export interface RecipientOption {
  id: string;
  name: string;
  role: string;
  available?: boolean;
}

/** Due date typed as a day; sent as the end of that day in UTC so the day itself is not overdue. */
export function endOfDayIso(date: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T23:59:59Z` : undefined;
}

/** Ask the client or a colleague a question, or request a document (command create_request). */
export function RequestCreateForm({
  revision,
  canCreate,
  actorRole,
  clients,
  staff,
  areas,
  defaultRefs = [],
  defaultArea,
  startOpen = false,
}: {
  revision: number;
  canCreate: boolean;
  actorRole: string;
  clients: RecipientOption[];
  staff: RecipientOption[];
  areas: { id: string; label: string }[];
  defaultRefs?: string[];
  defaultArea?: string;
  startOpen?: boolean;
}) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [open, setOpen] = useState(startOpen);
  const [kind, setKind] = useState<Kind>("client_question");
  const [toActorId, setToActorId] = useState(clients[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [refs, setRefs] = useState(defaultRefs.join(", "));
  const [dueDate, setDueDate] = useState("");
  const [area, setArea] = useState(defaultArea ?? "");
  const [created, setCreated] = useState<string | null>(null);

  const recipients = kind === "colleague_question" ? staff : clients;
  const changeKind = (k: Kind) => {
    setKind(k);
    const list = k === "colleague_question" ? staff : clients;
    if (!list.some((r) => r.id === toActorId)) setToActorId(list[0]?.id ?? "");
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondary} onClick={() => setOpen(true)}>
          New request
        </button>
        {created ? (
          <span className="text-xs text-emerald-700">
            Request sent:{" "}
            <Link href={`/people/requests/${encodeURIComponent(created)}`} className="num underline">
              {created}
            </Link>
          </span>
        ) : null}
        {!canCreate ? <span className="text-xs text-stone-500">A {actorRole} cannot send requests.</span> : null}
      </div>
    );
  }
  return (
    <form
      className="space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send("create_request", {
          kind,
          title,
          body,
          toActorId,
          refs: parseRefs(refs),
          dueAt: endOfDayIso(dueDate),
          area: area || undefined,
        });
        if (r.ok) {
          setCreated((r.result as { requestId: string }).requestId);
          setTitle("");
          setBody("");
          setOpen(false);
        }
      }}
    >
      {!canCreate ? <p className="text-xs text-amber-800">A {actorRole} cannot send requests; the server will refuse this.</p> : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={label}>
          Kind
          <select className={input} value={kind} onChange={(e) => changeKind(e.target.value as Kind)}>
            <option value="client_question">Client question</option>
            <option value="document_request">Document request (to the client)</option>
            <option value="colleague_question">Colleague question</option>
          </select>
        </label>
        <label className={label}>
          To
          <select className={input} value={toActorId} onChange={(e) => setToActorId(e.target.value)} required>
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.role}){r.available === false ? ", not yet active" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Due (optional)
          <input type="date" className={`${input} num`} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
      </div>
      <label className={label}>
        Title
        <input className={input} required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="One line the recipient will see in their inbox" />
      </label>
      <label className={label}>
        Question or request
        <textarea className={input} rows={3} required minLength={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What you need and why; the answer becomes citable evidence" />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={label}>
          References (comma separated: line keys, documents, values, answers)
          <input className={`${input} num`} value={refs} onChange={(e) => setRefs(e.target.value)} placeholder="F8949.H.C6, doc:D34#page1" />
        </label>
        <label className={label}>
          Area (optional; otherwise taken from the first reference)
          <select className={input} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">From the references</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Sending" : "Send request"}
        </button>
        <button type="button" className={secondary} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}
