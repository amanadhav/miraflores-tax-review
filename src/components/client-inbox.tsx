"use client";

import { CommandButton, CommandErrorBox, useCommand } from "@/components/command-client";
import { dateTime } from "@/lib/format";
import type { ClientNotificationView } from "@/server/queries/client";

const secondary = "rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100 disabled:opacity-50";

/** The client's own notifications with mark-read (command mark_notifications_read; the server scopes it to the recipient). */
export function ClientInbox({ revision, items }: { revision: number; items: ClientNotificationView[] }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const unread = items.filter((n) => !n.read).map((n) => n.id);
  if (items.length === 0) return <p className="text-sm text-stone-600">Nothing yet. You will be notified here when the firm has a question or your return is ready.</p>;
  return (
    <div className="space-y-2">
      {unread.length > 1 ? (
        <button type="button" disabled={pending} className={secondary} onClick={() => void send("mark_notifications_read", { notificationIds: unread })}>
          Mark all {unread.length} read
        </button>
      ) : null}
      <ul className="divide-y divide-stone-100">
        {items.map((n) => (
          <li key={n.id} className={`flex flex-wrap items-start justify-between gap-3 py-2 ${n.read ? "text-stone-500" : ""}`}>
            <div className="min-w-0 flex-1">
              <div className="text-sm">
                {!n.read ? <span className="mr-2 rounded bg-blue-100 px-1.5 py-0.5 text-[11px] text-blue-800">new</span> : null}
                <span className={n.read ? "" : "font-medium"}>{n.title}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-line text-xs text-stone-600">{n.body}</p>
              <div className="mt-0.5 text-[11px] text-stone-400">
                <span className="num">{dateTime(n.createdAt)}</span>
                {n.requestIds.map((id) => (
                  <a key={id} href={`#request-${id}`} className="ml-2 text-blue-700 hover:underline">
                    open the question
                  </a>
                ))}
              </div>
            </div>
            {!n.read ? (
              <CommandButton revision={revision} type="mark_notifications_read" payload={{ notificationIds: [n.id] }} className={secondary}>
                Mark read
              </CommandButton>
            ) : null}
          </li>
        ))}
      </ul>
      <CommandErrorBox error={error} onDismiss={clearError} />
    </div>
  );
}
