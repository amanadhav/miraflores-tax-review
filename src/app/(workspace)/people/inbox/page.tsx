import { CommandButton } from "@/components/command-client";
import { RefInline } from "@/components/line-refs";
import { dateTime } from "@/lib/format";
import { inboxView, isRefusal } from "@/server/queries/people";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

/** The current actor's notifications, newest first. Nothing leaves the app; this inbox is the delivery. */
export default async function InboxPage() {
  const ctx = await requireSessionContext();
  const v = await inboxView(ctx);
  if (isRefusal(v)) return <p className="text-sm text-stone-600">{v.message}</p>;
  const unreadIds = v.notifications.filter((n) => n.unread).map((n) => n.id);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-stone-600">
            For {v.actor.name} ({v.actor.role}): <span className="num">{v.unread}</span> unread of <span className="num">{v.total}</span>. Requests, replies and task assignments land here; the record itself lives on its own screen.
          </p>
        </div>
        {unreadIds.length > 0 ? (
          <CommandButton revision={v.revision} type="mark_notifications_read" payload={{ notificationIds: unreadIds }}>
            Mark all {unreadIds.length} read
          </CommandButton>
        ) : null}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        {v.notifications.length === 0 ? (
          <p className="px-5 py-4 text-sm text-stone-500">Nothing here yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {v.notifications.map((n) => (
              <li key={n.id} id={n.id} className={`flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3 text-sm ${n.unread ? "bg-amber-50/60" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {n.unread ? <span className="inline-block h-2 w-2 rounded-full bg-amber-500" title="unread" /> : null}
                    <span className={`font-medium ${n.unread ? "" : "text-stone-600"}`}>{n.title}</span>
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">{n.kindLabel}</span>
                    <span className="num text-xs text-stone-400">
                      {dateTime(n.createdAt)}, revision {n.createdRevision}
                    </span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-stone-700">{n.body}</p>
                  <div className="mt-0.5 text-xs">
                    <RefInline items={n.refs} />
                  </div>
                </div>
                <div className="text-xs">
                  {n.unread ? (
                    <CommandButton revision={v.revision} type="mark_notifications_read" payload={{ notificationIds: [n.id] }}>
                      Mark read
                    </CommandButton>
                  ) : (
                    <span className="text-stone-400">read {dateTime(n.readAt)}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
