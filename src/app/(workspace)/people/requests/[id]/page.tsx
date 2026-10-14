import Link from "next/link";
import { notFound } from "next/navigation";
import { RefInline } from "@/components/line-refs";
import { RefLink } from "@/components/ref-link";
import { RequestStatusBadge } from "@/components/request-status";
import { ReplyForm, ResolveForm } from "@/components/request-thread-forms";
import { dateOnly, dateTime } from "@/lib/format";
import { isRefusal, requestDetail, type AttachmentView } from "@/server/queries/people";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function AttachmentList({ items }: { items: AttachmentView[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {items.map((a) => (
        <li key={a.id} className="rounded border border-stone-200 bg-white p-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-600">{a.kind}</span>
            <a href={a.href} className="font-medium text-blue-700 hover:underline" title="Download from the attachments API">
              {a.filename}
            </a>
            <span className="num text-stone-500">{a.byteLength} bytes</span>
            <span className="text-stone-500">{a.contentType}</span>
            <span className="text-stone-500">
              {a.provenance} by {a.uploadedBy.name}, {dateTime(a.businessTime)}
            </span>
          </div>
          <div className="num mt-0.5 break-all text-[11px] text-stone-400">sha256 {a.sha256}</div>
          <div className="mt-0.5 text-stone-500">
            Cite as <span className="num">{a.ref}</span>
            {a.linkedRefs.length ? (
              <>
                ; linked to <RefInline items={a.linkedRefs} />
              </>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One request: the thread, its attachments and the evidence it produced. */
export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSessionContext();
  const { id } = await params;
  const v = await requestDetail(ctx, decodeURIComponent(id));
  if (v === null) notFound();
  if (isRefusal(v)) return <p className="text-sm text-stone-600">{v.message}</p>;
  const r = v.request;

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs text-stone-500">
          <Link href="/people/requests" className="hover:underline">
            Requests
          </Link>{" "}
          / <span className="num">{r.id}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
          <RequestStatusBadge status={r.status} overdue={r.overdue} />
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs text-stone-600 sm:grid-cols-[auto_1fr_auto_1fr]">
          <dt className="text-stone-400">Kind</dt>
          <dd>{r.kindLabel}</dd>
          <dt className="text-stone-400">Area</dt>
          <dd>{r.areaLabel}</dd>
          <dt className="text-stone-400">From</dt>
          <dd>
            {r.from.name} ({r.from.role})
          </dd>
          <dt className="text-stone-400">To</dt>
          <dd>
            {r.to.name} ({r.to.role})
          </dd>
          <dt className="text-stone-400">Asked</dt>
          <dd className="num">
            {dateTime(r.businessTime)} (business time), revision {r.createdRevision}
          </dd>
          <dt className="text-stone-400">Due</dt>
          <dd className={`num ${r.overdue ? "font-medium text-red-700" : ""}`}>
            {r.dueAt ? dateOnly(r.dueAt) : "none"}
            {r.overdue ? ` (overdue at the replay clock, ${dateOnly(v.asOf)})` : ""}
          </dd>
          <dt className="text-stone-400">References</dt>
          <dd className="sm:col-span-3">
            <RefInline items={r.refs} />
          </dd>
        </dl>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="font-medium">Thread</h2>
        <ol className="mt-3 space-y-3">
          <li className="rounded border border-stone-200 bg-stone-50 p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-stone-500">
              <span className="font-medium text-stone-800">{r.from.name}</span>
              <span>{r.from.role}</span>
              <span className="num">{dateTime(r.businessTime)}</span>
              <span>asked</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-stone-800">{r.body}</p>
          </li>
          {v.thread.map((reply) => (
            <li key={reply.id} id={reply.id} className="rounded border border-stone-200 p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-stone-500">
                <span className="font-medium text-stone-800">{reply.author.name}</span>
                <span>{reply.author.role}</span>
                <span className="num">{dateTime(reply.businessTime)}</span>
                <span>
                  replied at revision <span className="num">{reply.createdRevision}</span>
                </span>
                <span className="num">{reply.ref}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-stone-800">{reply.body}</p>
              <AttachmentList items={reply.attachments} />
            </li>
          ))}
          {v.pendingAttachments.length > 0 ? (
            <li className="rounded border border-dashed border-stone-300 p-3 text-sm">
              <div className="text-xs text-stone-500">Attached to this request but not yet carried by a reply</div>
              <AttachmentList items={v.pendingAttachments} />
            </li>
          ) : null}
          {r.status === "resolved" || r.status === "withdrawn" ? (
            <li className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <div className="text-xs text-stone-500">
                {r.status === "resolved" ? "Resolved" : "Withdrawn"} by {r.resolvedBy?.name ?? "unknown"} at revision <span className="num">{r.resolvedRevision}</span>
              </div>
              <p className="mt-1 text-stone-800">{r.resolution}</p>
            </li>
          ) : null}
        </ol>
        <div className="mt-4 space-y-3">
          <ReplyForm requestId={r.id} revision={v.revision} canReply={v.actor.canReply} canAttach={v.actor.canAttach} actorRole={v.actor.role} actorName={v.actor.name} />
          {v.actor.canReply ? <ResolveForm requestId={r.id} revision={v.revision} canResolve={v.actor.canResolve} actorRole={v.actor.role} /> : null}
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="font-medium">Evidence this request produced</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          Each reply and attachment is a workpaper record with its author and business time. Cite it from an adjustment, finding, verification or judgment by its reference (for example{" "}
          <span className="num">reply:rpl_abc</span>); the server checks that the record exists in this workspace.
        </p>
        {v.evidence.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No replies or attachments yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1 pr-3 font-normal">Reference</th>
                <th className="py-1 pr-3 font-normal">What</th>
                <th className="py-1 font-normal">Cited by</th>
              </tr>
            </thead>
            <tbody>
              {v.evidence.map((e) => (
                <tr key={e.ref} className="border-t border-stone-100 align-top">
                  <td className="num py-1 pr-3 text-xs whitespace-nowrap">{e.ref}</td>
                  <td className="py-1 pr-3 text-xs">{e.label}</td>
                  <td className="py-1 text-xs">
                    {e.citedBy.length === 0 ? (
                      <span className="text-stone-400">not cited yet; cite this reference to make the answer part of the return&apos;s support</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {e.citedBy.map((c) => (
                          <li key={c.ref}>
                            <RefLink refId={c.ref} label={c.label} className="text-xs text-blue-700 hover:underline" />
                            <span className="ml-2 text-stone-500">
                              {c.status.replace(/_/g, " ")}, {c.actor.name}, revision <span className="num">{c.createdRevision}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
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
