import Link from "next/link";
import { RefInline } from "@/components/line-refs";
import { TaskCompleteForm, TaskCreateForm } from "@/components/task-form";
import { dateOnly } from "@/lib/format";
import { isRefusal, TASK_STATUSES, tasksView, type TaskRow } from "@/server/queries/people";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

interface Params {
  status?: string | null;
  kind?: string | null;
  mine?: boolean;
  overdue?: boolean;
}

function href(p: Params): string {
  const q = new URLSearchParams();
  if (p.status) q.set("status", p.status);
  if (p.kind) q.set("kind", p.kind);
  if (p.mine) q.set("mine", "1");
  if (p.overdue) q.set("overdue", "1");
  const s = q.toString();
  return s ? `/people/tasks?${s}` : "/people/tasks";
}

function FilterChip({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link href={href} className={`rounded-full border px-2.5 py-0.5 ${active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100"}`}>
      {label}
    </Link>
  );
}

function TaskStatusBadge({ status, overdue }: { status: string; overdue: boolean }) {
  const tone = status === "open" ? "bg-amber-100 text-amber-800" : status === "done" ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`rounded px-1.5 py-0.5 text-xs ${tone}`}>{status}</span>
      {overdue ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">overdue</span> : null}
    </span>
  );
}

function TaskTable({ rows, revision, actorRole, empty }: { rows: TaskRow[]; revision: number; actorRole: string; empty: string }) {
  if (rows.length === 0) return <p className="px-5 py-4 text-sm text-stone-500">{empty}</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-stone-500">
        <tr>
          <th className="px-5 py-2 font-normal">Task</th>
          <th className="px-2 py-2 font-normal">Kind</th>
          <th className="px-2 py-2 font-normal">Owner</th>
          <th className="px-2 py-2 font-normal">Due</th>
          <th className="px-2 py-2 font-normal">Status</th>
          <th className="px-2 py-2 font-normal">References</th>
          <th className="px-2 py-2 font-normal">Area</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.id} id={x.id} className={`border-t border-stone-100 align-top ${x.overdue ? "bg-red-50/40" : ""}`}>
            <td className="px-5 py-2">
              <div className="font-medium">{x.title}</div>
              <p className="text-xs text-stone-600">{x.detail}</p>
              <div className="text-xs text-stone-400">
                <span className="num">{x.id}</span>, assigned by {x.createdBy.name} at revision <span className="num">{x.createdRevision}</span>
              </div>
              {x.status !== "open" ? (
                <div className="mt-1 text-xs text-stone-600">
                  {x.status === "done" ? "Done" : "Cancelled"} by {x.completedBy?.name ?? "unknown"} at revision <span className="num">{x.completedRevision}</span>: {x.completionNote}
                  {x.completionRefs.length ? (
                    <div>
                      Evidence: <RefInline items={x.completionRefs} />
                    </div>
                  ) : null}
                </div>
              ) : (
                <TaskCompleteForm taskId={x.id} kind={x.kind} revision={revision} canComplete={x.canComplete} actorRole={actorRole} ownerName={x.owner.name} />
              )}
            </td>
            <td className="px-2 py-2 text-xs">{x.kindLabel}</td>
            <td className="px-2 py-2 text-xs">
              {x.owner.name}
              {x.mine ? <span className="text-stone-500"> (you)</span> : null}
            </td>
            <td className={`num px-2 py-2 text-xs whitespace-nowrap ${x.overdue ? "font-medium text-red-700" : ""}`}>{x.dueAt ? dateOnly(x.dueAt) : <span className="text-stone-400">none</span>}</td>
            <td className="px-2 py-2">
              <TaskStatusBadge status={x.status} overdue={x.overdue} />
            </td>
            <td className="px-2 py-2">
              <RefInline items={x.refs} />
            </td>
            <td className="px-2 py-2 text-xs">{x.areaLabel}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Tasks for the engagement, with outside filings tracked in their own group. */
export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSessionContext();
  const sp = await searchParams;
  const v = await tasksView(ctx, { status: one(sp.status), kind: one(sp.kind), mine: one(sp.mine) === "1", overdue: one(sp.overdue) === "1" });
  if (isRefusal(v)) return <p className="text-sm text-stone-600">{v.message}</p>;
  const f = v.filters;
  const base = { status: f.status, kind: f.kind, mine: f.mine, overdue: f.overdue };

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="mt-1 text-sm text-stone-600">
          <span className="num">{v.counts.open}</span> open of <span className="num">{v.counts.total}</span>, <span className="num">{v.counts.mine}</span> open for you
          {v.counts.overdue > 0 ? (
            <>
              , <span className="num text-red-700">{v.counts.overdue}</span> overdue
            </>
          ) : null}
          . Overdue is judged at the replay clock, <span className="num">{dateOnly(v.asOf)}</span>. Completion needs a note; an outside filing also needs evidence.
        </p>
      </section>

      <TaskCreateForm
        revision={v.revision}
        canCreate={v.actor.canCreate}
        actorRole={v.actor.role}
        owners={v.owners}
        areas={v.areas}
        defaults={{ kind: f.kind === "outside_filing" ? "outside_filing" : undefined }}
        startOpen={one(sp.new) === "1"}
      />

      <section className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-stone-500">Status:</span>
        <FilterChip active={!f.status} href={href({ ...base, status: null })} label={`all ${v.counts.total}`} />
        {TASK_STATUSES.map((s) => (
          <FilterChip key={s} active={f.status === s} href={href({ ...base, status: s })} label={`${s} ${v.counts[s]}`} />
        ))}
        <span className="ml-4 text-stone-500">Show:</span>
        <FilterChip active={f.mine} href={href({ ...base, mine: !f.mine })} label="mine" />
        <FilterChip active={f.overdue} href={href({ ...base, overdue: !f.overdue })} label="overdue" />
        <span className="ml-4 text-stone-500">Kind:</span>
        <FilterChip active={!f.kind} href={href({ ...base, kind: null })} label="all kinds" />
        {v.kinds.map((k) => (
          <FilterChip key={k.value} active={f.kind === k.value} href={href({ ...base, kind: k.value })} label={k.label} />
        ))}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Review, follow-up and planning</h2>
          <span className="text-xs text-stone-500">{v.tasks.length} task(s)</span>
        </div>
        <TaskTable rows={v.tasks} revision={v.revision} actorRole={v.actor.role} empty="No tasks match these filters." />
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Outside filings</h2>
            <span className="text-xs text-stone-500">{v.outsideFilings.length} task(s)</span>
          </div>
          <p className="mt-1 text-xs text-stone-600">{v.packetContext.note}</p>
          <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <div className="text-stone-500">Deadlines from the firm&apos;s list</div>
              <ul className="mt-0.5 space-y-0.5">
                {v.packetContext.deadlines.map((d) => (
                  <li key={d.what}>
                    <span className="num">{d.date}</span> {d.what}{" "}
                    <span className={d.daysFromClock < 0 ? "text-red-700" : "text-stone-500"}>({d.daysFromClock < 0 ? `${-d.daysFromClock} days past at the clock` : d.daysFromClock === 0 ? "today" : `in ${d.daysFromClock} days`})</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-stone-500">Packet evidence</div>
              <div className="mt-0.5">
                <RefInline items={v.packetContext.refs} />
              </div>
            </div>
          </div>
        </div>
        <TaskTable rows={v.outsideFilings} revision={v.revision} actorRole={v.actor.role} empty="No outside filing tasks match these filters. Create one with kind Outside filing." />
      </section>
    </div>
  );
}
