import { dateTime } from "@/lib/format";
import type { AuditEventView } from "@/server/queries/changes";
import { MetaPairs } from "./changes-value";
import { RefLink } from "./ref-link";

/**
 * One audit event: who did what, in plain words, with the business time (the
 * replay clock when it happened) and the server time side by side, and the
 * before/after metadata as compact pairs. Everything arrives already redacted.
 */
export function AuditEventItem({ event, showRevision = true }: { event: AuditEventView; showRevision?: boolean }) {
  return (
    <li id={`audit-${event.id}`} className="border-t border-stone-100 py-2 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        {showRevision ? <span className="num text-xs text-stone-500">rev {event.revision}</span> : null}
        <span className="font-medium">{event.actorName}</span>
        <span>{event.actionLabel}</span>
        {event.areaLabel ? <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">{event.areaLabel}</span> : null}
        {event.entityRef ? <RefLink refId={event.entityRef} label={event.entityId} /> : null}
      </div>
      <p className="mt-0.5 text-sm text-stone-700">{event.summary}</p>
      <div className="mt-0.5 text-xs text-stone-500">
        business time <span className="num">{dateTime(event.businessTime)}</span>, server time <span className="num">{dateTime(event.createdAt)}</span>
      </div>
      <MetaPairs label="before" data={event.before} />
      <MetaPairs label="after" data={event.after} />
    </li>
  );
}

export function AuditEventList({ events, showRevision = true, emptyText }: { events: AuditEventView[]; showRevision?: boolean; emptyText?: string }) {
  if (events.length === 0) return <p className="text-sm text-stone-500">{emptyText ?? "No events."}</p>;
  return (
    <ul>
      {events.map((e) => (
        <AuditEventItem key={e.id} event={e} showRevision={showRevision} />
      ))}
    </ul>
  );
}
