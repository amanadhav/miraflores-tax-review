import Link from "next/link";
import { RefInline } from "@/components/line-refs";
import { RequestCreateForm } from "@/components/request-form";
import { RequestStatusBadge } from "@/components/request-status";
import { dateOnly } from "@/lib/format";
import { isRefusal, REQUEST_STATUSES, requestsView } from "@/server/queries/people";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function href(params: { status?: string | null; kind?: string | null }): string {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.kind) q.set("kind", params.kind);
  const s = q.toString();
  return s ? `/people/requests?${s}` : "/people/requests";
}

function FilterChip({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link href={href} className={`rounded-full border px-2.5 py-0.5 ${active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100"}`}>
      {label}
    </Link>
  );
}

/** Questions to the client or a colleague and document requests. An answer is evidence the workpaper can cite. */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSessionContext();
  const sp = await searchParams;
  const v = await requestsView(ctx, { status: one(sp.status), kind: one(sp.kind) });
  if (isRefusal(v)) return <p className="text-sm text-stone-600">{v.message}</p>;
  const startOpen = one(sp.new) === "1";

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="mt-1 text-sm text-stone-600">
            <span className="num">{v.total}</span> requests, <span className="num">{v.counts.open + v.counts.answered}</span> still open
            {v.overdue > 0 ? (
              <>
                , <span className="num text-red-700">{v.overdue}</span> overdue
              </>
            ) : null}
            . Due dates and overdue flags are judged at the replay clock, <span className="num">{dateOnly(v.asOf)}</span>. A reply is recorded as evidence (reply:id) and can be cited by adjustments, findings and judgments.
          </p>
        </div>
      </section>

      <RequestCreateForm
        revision={v.revision}
        canCreate={v.actor.canCreate}
        actorRole={v.actor.role}
        clients={v.recipients.clients}
        staff={v.recipients.staff}
        areas={v.areas}
        defaultRefs={one(sp.refs) ? one(sp.refs)!.split(",") : []}
        startOpen={startOpen}
      />

      <section className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-stone-500">Status:</span>
        <FilterChip active={!v.filters.status} href={href({ kind: v.filters.kind })} label={`all ${v.total}`} />
        {REQUEST_STATUSES.map((s) => (
          <FilterChip key={s} active={v.filters.status === s} href={href({ status: s, kind: v.filters.kind })} label={`${s} ${v.counts[s]}`} />
        ))}
        <span className="ml-4 text-stone-500">Kind:</span>
        <FilterChip active={!v.filters.kind} href={href({ status: v.filters.status })} label="all kinds" />
        {v.kinds.map((k) => (
          <FilterChip key={k.value} active={v.filters.kind === k.value} href={href({ status: v.filters.status, kind: k.value })} label={k.label} />
        ))}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        {v.requests.length === 0 ? (
          <p className="px-5 py-4 text-sm text-stone-500">No requests match these filters.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-5 py-2 font-normal">Request</th>
                <th className="px-2 py-2 font-normal">Kind</th>
                <th className="px-2 py-2 font-normal">From</th>
                <th className="px-2 py-2 font-normal">To</th>
                <th className="px-2 py-2 font-normal">Due</th>
                <th className="px-2 py-2 font-normal">Status</th>
                <th className="px-2 py-2 font-normal">References</th>
                <th className="px-2 py-2 font-normal">Area</th>
                <th className="px-2 py-2 text-right font-normal">Replies</th>
              </tr>
            </thead>
            <tbody>
              {v.requests.map((r) => (
                <tr key={r.id} className={`border-t border-stone-100 align-top ${r.overdue ? "bg-red-50/40" : ""}`}>
                  <td className="px-5 py-2">
                    <Link href={`/people/requests/${encodeURIComponent(r.id)}`} className="font-medium hover:underline">
                      {r.title}
                    </Link>
                    <div className="text-xs text-stone-500">
                      <span className="num">{r.id}</span>, asked {dateOnly(r.businessTime)} at revision <span className="num">{r.createdRevision}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-xs">{r.kindLabel}</td>
                  <td className="px-2 py-2 text-xs">{r.from.name}</td>
                  <td className="px-2 py-2 text-xs">
                    {r.to.name} <span className="text-stone-500">({r.to.role})</span>
                  </td>
                  <td className={`num px-2 py-2 text-xs whitespace-nowrap ${r.overdue ? "font-medium text-red-700" : ""}`}>{r.dueAt ? dateOnly(r.dueAt) : <span className="text-stone-400">none</span>}</td>
                  <td className="px-2 py-2">
                    <RequestStatusBadge status={r.status} overdue={r.overdue} />
                  </td>
                  <td className="px-2 py-2">
                    <RefInline items={r.refs} />
                  </td>
                  <td className="px-2 py-2 text-xs">{r.areaLabel}</td>
                  <td className="num px-2 py-2 text-right text-xs">
                    {r.replyCount}
                    {r.lastReplyAt ? <div className="text-stone-400">{dateOnly(r.lastReplyAt)}</div> : null}
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
