"use client";

import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";
import { dateTime } from "@/lib/format";
import type { ClientAttachmentView, ClientRequestView } from "@/server/queries/client";

const input = "mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm";
const label = "block text-xs text-stone-500";
const primary = "rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50";
const secondary = "rounded border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50";

export const MAX_UPLOAD_BYTES = 1_000_000;

function AttachmentLinks({ items }: { items: ClientAttachmentView[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {items.map((a) => (
        <li key={a.id}>
          <a href={a.href} className="text-blue-700 hover:underline">
            {a.filename}
          </a>
          <span className="ml-1 text-stone-500">
            ({a.kind}, {a.contentType}, <span className="num">{a.byteLength}</span> bytes)
          </span>
        </li>
      ))}
    </ul>
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * One request addressed to the client: the question, the thread of replies
 * and attachments, a reply form and an attachment form. Attaching goes
 * through add_attachment then reply_request, each with the revision the
 * previous step returned, so a colleague's change in between is a visible
 * conflict rather than a silent overwrite.
 */
export function ClientRequestThread({ revision, request, viewerName }: { revision: number; request: ClientRequestView; viewerName: string }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [body, setBody] = useState("");
  const [attachMode, setAttachMode] = useState<"none" | "note" | "file">("none");
  const [noteName, setNoteName] = useState("note.txt");
  const [noteText, setNoteText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSaved(null);
    const text = body.trim();
    if (!text) {
      setLocalError("Write a reply first.");
      return;
    }
    let attachmentIds: string[] = [];
    let expected = revision;
    if (attachMode === "note") {
      if (!noteText.trim()) {
        setLocalError("The note is empty.");
        return;
      }
      const r = await send("add_attachment", { kind: "note", filename: noteName.trim() || "note.txt", contentType: "text/plain", content: noteText, encoding: "utf8", requestId: request.id });
      if (!r.ok) return;
      attachmentIds = [(r.result as { attachmentId: string }).attachmentId];
      expected = r.revision;
    } else if (attachMode === "file") {
      if (!file) {
        setLocalError("Choose a file first.");
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setLocalError(`The file is ${file.size} bytes; the limit is ${MAX_UPLOAD_BYTES} bytes (1 MB).`);
        return;
      }
      let content: string;
      try {
        content = await readFileAsBase64(file);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "Could not read the file.");
        return;
      }
      const r = await send("add_attachment", { kind: "file", filename: file.name, contentType: file.type || "application/octet-stream", content, encoding: "base64", requestId: request.id });
      if (!r.ok) return;
      attachmentIds = [(r.result as { attachmentId: string }).attachmentId];
      expected = r.revision;
    }
    const reply = await send("reply_request", { requestId: request.id, body: text, attachmentIds }, { expectedRevision: expected });
    if (reply.ok) {
      setSaved((reply.result as { replyId: string }).replyId);
      setBody("");
      setNoteText("");
      setFile(null);
      setAttachMode("none");
    }
  };

  return (
    <article id={`request-${request.id}`} className="rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{request.title}</h3>
        <span className="text-xs text-stone-500">
          {request.kindLabel} from {request.fromName}, <span className="num">{dateTime(request.askedAt)}</span>
          {request.dueAt ? (
            <>
              , due <span className="num">{request.dueAt.slice(0, 10)}</span>
            </>
          ) : null}
          , {request.open ? <span className="text-amber-800">{request.status}</span> : <span>{request.status}</span>}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm">{request.body}</p>
      {request.about.length ? <p className="mt-1 text-xs text-stone-500">About: {request.about.join("; ")}</p> : null}
      {request.pendingAttachments.length ? (
        <div className="mt-2 text-xs text-stone-500">
          Attached to this request:
          <AttachmentLinks items={request.pendingAttachments} />
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {request.replies.length === 0 ? <p className="text-xs text-stone-500">No replies yet.</p> : null}
        {request.replies.map((r) => (
          <div key={r.id} className={`rounded border p-3 text-sm ${r.mine ? "border-blue-100 bg-blue-50" : "border-stone-100 bg-stone-50"}`}>
            <div className="text-xs text-stone-500">
              <span className="font-medium text-stone-700">{r.mine ? `You (${viewerName})` : r.authorName}</span>, <span className="num">{dateTime(r.businessTime)}</span>
            </div>
            <p className="mt-1 whitespace-pre-line">{r.body}</p>
            <AttachmentLinks items={r.attachments} />
          </div>
        ))}
      </div>

      {request.resolution ? <p className="mt-3 text-xs text-stone-600">Closed by the firm: {request.resolution}</p> : null}

      {request.open ? (
        <form className="mt-4 space-y-2 border-t border-stone-100 pt-3" onSubmit={submit}>
          <label className={label}>
            Your reply
            <textarea className={`${input} min-h-20`} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Answer the question; what you write becomes part of the file." />
          </label>
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" className={attachMode === "none" ? primary : secondary} onClick={() => setAttachMode("none")}>
              No attachment
            </button>
            <button type="button" className={attachMode === "note" ? primary : secondary} onClick={() => setAttachMode("note")}>
              Paste a note
            </button>
            <button type="button" className={attachMode === "file" ? primary : secondary} onClick={() => setAttachMode("file")}>
              Attach a file (1 MB max)
            </button>
          </div>
          {attachMode === "note" ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_3fr]">
              <label className={label}>
                Note name
                <input className={input} value={noteName} onChange={(e) => setNoteName(e.target.value)} />
              </label>
              <label className={label}>
                Note text
                <textarea className={`${input} min-h-16`} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Paste the confirmation text, dates and amounts." />
              </label>
            </div>
          ) : null}
          {attachMode === "file" ? (
            <label className={label}>
              File (read in your browser and sent as base64; 1 MB max)
              <input type="file" className="mt-1 block text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              {file ? (
                <span className="text-stone-600">
                  {file.name}, <span className="num">{file.size}</span> bytes
                </span>
              ) : null}
            </label>
          ) : null}
          <button type="submit" disabled={pending} className={primary}>
            {pending ? "Sending" : attachMode === "none" ? "Send reply" : "Attach and send reply"}
          </button>
          {saved ? (
            <span className="ml-2 text-xs text-emerald-700">
              Sent; recorded as reply <span className="num">{saved}</span>.
            </span>
          ) : null}
          {localError ? <p className="text-xs text-red-700">{localError}</p> : null}
          <CommandErrorBox error={error} onDismiss={clearError} />
        </form>
      ) : null}
    </article>
  );
}
