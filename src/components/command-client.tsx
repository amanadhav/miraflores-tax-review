"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

export interface CommandError {
  code: string;
  message: string;
  currentRevision?: number;
  changesSince?: { action: string; summary: string; actorId: string; revision: number }[];
  issues?: { path: string; message: string }[];
}

export type CommandOutcome = { ok: true; revision: number; result: unknown; replayed: boolean } | { ok: false; error: CommandError };

function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Sends one command through /api/commands with the revision this screen was
 * rendered from and a fresh idempotency key per attempt. A conflict is shown,
 * never silently retried on top of a colleague's change.
 */
export function useCommand(revision: number) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CommandError | null>(null);
  const [lastResult, setLastResult] = useState<unknown>(null);

  const send = useCallback(
    async (type: string, payload: unknown, options: { expectedRevision?: number; idempotencyKey?: string } = {}): Promise<CommandOutcome> => {
      setPending(true);
      setError(null);
      try {
        const res = await fetch("/api/commands", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type,
            payload,
            expectedRevision: options.expectedRevision ?? revision,
            idempotencyKey: options.idempotencyKey ?? newKey(),
          }),
        });
        const data = (await res.json()) as CommandOutcome;
        if (data.ok) {
          setLastResult(data.result);
          router.refresh();
        } else {
          setError(data.error);
          if (data.error.code === "conflict") router.refresh();
        }
        return data;
      } catch (e) {
        const err = { code: "network", message: e instanceof Error ? e.message : "Network error" };
        setError(err);
        return { ok: false, error: err };
      } finally {
        setPending(false);
      }
    },
    [revision, router],
  );

  return { send, pending, error, lastResult, clearError: () => setError(null) };
}

export function CommandErrorBox({ error, onDismiss }: { error: CommandError | null; onDismiss?: () => void }) {
  if (!error) return null;
  const tone = error.code === "conflict" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-800";
  return (
    <div className={`mt-2 rounded border p-3 text-sm ${tone}`} role="alert">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-medium">{labelFor(error.code)}:</span> {error.message}
        </div>
        {onDismiss ? (
          <button type="button" onClick={onDismiss} className="text-xs underline">
            dismiss
          </button>
        ) : null}
      </div>
      {error.changesSince?.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          {error.changesSince.map((c, i) => (
            <li key={i}>
              rev {c.revision}, {c.actorId}: {c.summary}
            </li>
          ))}
        </ul>
      ) : null}
      {error.issues?.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          {error.issues.map((i, k) => (
            <li key={k}>
              {i.path || "payload"}: {i.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function labelFor(code: string): string {
  switch (code) {
    case "conflict":
      return "Someone else changed the workpaper";
    case "forbidden":
      return "Not allowed for this person";
    case "self_review":
      return "No self-review";
    case "partner_required":
      return "Partner approval required";
    case "unavailable":
      return "Not available at this date";
    case "filing_locked":
      return "Frozen for filing";
    case "validation":
      return "Check the input";
    default:
      return "Could not apply";
  }
}

/** A single-action button that sends one command. */
export function CommandButton({
  revision,
  type,
  payload,
  children,
  className,
  confirm,
}: {
  revision: number;
  type: string;
  payload: unknown;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
}) {
  const { send, pending, error, clearError } = useCommand(revision);
  return (
    <span className="inline-block">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          void send(type, payload);
        }}
        className={className ?? "rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100 disabled:opacity-50"}
      >
        {pending ? "Saving" : children}
      </button>
      <CommandErrorBox error={error} onDismiss={clearError} />
    </span>
  );
}
