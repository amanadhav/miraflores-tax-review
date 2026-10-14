"use client";

import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";
import { parseRefs } from "@/components/finding-forms";

const input = "mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm";
const label = "block text-xs text-stone-500";
const primary = "rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50";
const secondary = "rounded border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50";

const MAX_FILE_BYTES = 700_000;

type AttachKind = "none" | "note" | "file";

interface Picked {
  filename: string;
  contentType: string;
  content: string;
  encoding: "utf8" | "base64";
  bytes: number;
}

function readFile(file: File): Promise<Picked> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const isText = file.type.startsWith("text/") || /\.(txt|csv|md|json)$/i.test(file.name);
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return reject(new Error("Could not read the file."));
      if (isText) return resolve({ filename: file.name, contentType: file.type || "text/plain", content: result, encoding: "utf8", bytes: file.size });
      const comma = result.indexOf(",");
      resolve({ filename: file.name, contentType: file.type || "application/octet-stream", content: result.slice(comma + 1), encoding: "base64", bytes: file.size });
    };
    if (isText) reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

/**
 * Reply to a request, optionally attaching a note or a small file first
 * (commands add_attachment then reply_request). The attachment is recorded
 * with its hash and provenance before the reply cites it.
 */
export function ReplyForm({ requestId, revision, canReply, canAttach, actorRole, actorName }: { requestId: string; revision: number; canReply: boolean; canAttach: boolean; actorRole: string; actorName: string }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [body, setBody] = useState("");
  const [attachKind, setAttachKind] = useState<AttachKind>("none");
  const [noteName, setNoteName] = useState("");
  const [noteText, setNoteText] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [linkedRefs, setLinkedRefs] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (!canReply) return <p className="text-sm text-stone-500">This request is closed; no further replies.</p>;

  return (
    <form
      className="space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError(null);
        setSaved(null);
        let expectedRevision = revision;
        const attachmentIds: string[] = [];
        if (attachKind === "note") {
          if (!noteText.trim()) return setLocalError("Write the note before attaching it.");
          const r = await send("add_attachment", {
            kind: "note",
            filename: noteName.trim() || "note.txt",
            contentType: "text/plain",
            content: noteText,
            encoding: "utf8",
            requestId,
            linkedRefs: parseRefs(linkedRefs),
          });
          if (!r.ok) return;
          attachmentIds.push((r.result as { attachmentId: string }).attachmentId);
          expectedRevision = r.revision;
        } else if (attachKind === "file") {
          if (!picked) return setLocalError("Choose a file to attach.");
          const r = await send("add_attachment", {
            kind: "file",
            filename: picked.filename,
            contentType: picked.contentType,
            content: picked.content,
            encoding: picked.encoding,
            requestId,
            linkedRefs: parseRefs(linkedRefs),
          });
          if (!r.ok) return;
          attachmentIds.push((r.result as { attachmentId: string }).attachmentId);
          expectedRevision = r.revision;
        }
        const reply = await send("reply_request", { requestId, body, attachmentIds }, { expectedRevision });
        if (reply.ok) {
          setSaved((reply.result as { evidenceRef: string }).evidenceRef);
          setBody("");
          setNoteText("");
          setNoteName("");
          setPicked(null);
          setAttachKind("none");
        }
      }}
    >
      <label className={label}>
        Reply as {actorName} ({actorRole})
        <textarea className={input} rows={3} required minLength={1} maxLength={8000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="The answer, in the words it was given; it is recorded at the replay clock as evidence" />
      </label>
      <fieldset className="rounded border border-stone-200 bg-white p-2">
        <legend className="px-1 text-xs text-stone-500">Attach evidence with the reply (optional)</legend>
        <div className="flex flex-wrap gap-4 text-xs text-stone-700">
          {(["none", "note", "file"] as AttachKind[]).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input type="radio" name="attach" checked={attachKind === k} onChange={() => setAttachKind(k)} disabled={k !== "none" && !canAttach} />
              {k === "none" ? "Nothing" : k === "note" ? "A note (typed text)" : "A small file"}
            </label>
          ))}
          {!canAttach ? <span className="text-stone-500">A {actorRole} cannot attach evidence here.</span> : null}
        </div>
        {attachKind === "note" ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_2fr]">
            <label className={label}>
              Note name
              <input className={input} value={noteName} onChange={(e) => setNoteName(e.target.value)} placeholder="client-call.txt" maxLength={200} />
            </label>
            <label className={label}>
              Note text
              <textarea className={input} rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} maxLength={100_000} />
            </label>
          </div>
        ) : null}
        {attachKind === "file" ? (
          <div className="mt-2 space-y-1">
            <input
              type="file"
              className="block text-xs"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return setPicked(null);
                if (f.size > MAX_FILE_BYTES) {
                  setPicked(null);
                  return setLocalError(`Files are limited to ${Math.round(MAX_FILE_BYTES / 1000)} KB in this demo; larger files stay outside the workpaper.`);
                }
                try {
                  setPicked(await readFile(f));
                  setLocalError(null);
                } catch (err) {
                  setLocalError(err instanceof Error ? err.message : "Could not read the file.");
                }
              }}
            />
            {picked ? (
              <p className="text-xs text-stone-600">
                {picked.filename}, <span className="num">{picked.bytes}</span> bytes, {picked.contentType}. The server stores it with a SHA-256 hash and the uploader&apos;s identity.
              </p>
            ) : null}
          </div>
        ) : null}
        {attachKind !== "none" ? (
          <label className={`${label} mt-2`}>
            Link the attachment to references (optional, comma separated; staff only)
            <input className={`${input} num`} value={linkedRefs} onChange={(e) => setLinkedRefs(e.target.value)} placeholder="F8949.H.C6" />
          </label>
        ) : null}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving" : attachKind === "none" ? "Reply" : "Attach and reply"}
        </button>
        {saved ? (
          <span className="text-xs text-emerald-700">
            Recorded as <span className="num">{saved}</span>; cite it from an adjustment, finding or judgment.
          </span>
        ) : null}
      </div>
      {localError ? <p className="text-xs text-red-700">{localError}</p> : null}
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}

/** Close a request as resolved or withdrawn (command resolve_request). */
export function ResolveForm({ requestId, revision, canResolve, actorRole }: { requestId: string; revision: number; canResolve: boolean; actorRole: string }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<"resolved" | "withdrawn">("resolved");
  const [resolution, setResolution] = useState("");
  const [done, setDone] = useState<string | null>(null);

  if (done) return <p className="text-sm text-emerald-700">Request {done}.</p>;
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondary} onClick={() => setOpen(true)}>
          Resolve or withdraw
        </button>
        {!canResolve ? <span className="text-xs text-stone-500">A {actorRole} cannot close requests.</span> : null}
      </div>
    );
  }
  return (
    <form
      className="space-y-2 rounded border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send("resolve_request", { requestId, outcome, resolution });
        if (r.ok) setDone(outcome);
      }}
    >
      {!canResolve ? <p className="text-xs text-amber-800">A {actorRole} cannot close requests; the server will refuse this.</p> : null}
      <label className={label}>
        Outcome
        <select className={input} value={outcome} onChange={(e) => setOutcome(e.target.value as "resolved" | "withdrawn")}>
          <option value="resolved">Resolved (the answer settled it)</option>
          <option value="withdrawn">Withdrawn (no longer needed)</option>
        </select>
      </label>
      <label className={label}>
        Resolution
        <textarea className={input} rows={2} required minLength={2} maxLength={4000} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What the answer established and where it was recorded" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving" : outcome === "resolved" ? "Mark resolved" : "Withdraw"}
        </button>
        <button type="button" className={secondary} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}
