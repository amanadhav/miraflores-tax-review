import Link from "next/link";
import { BatchList, CompletenessTable } from "@/components/batch-disposition";
import { AreaApplicabilityForm } from "@/components/disposition-form";
import { RefInline } from "@/components/line-refs";
import { TaskCreateForm } from "@/components/task-form";
import { dateOnly } from "@/lib/format";
import { completenessView, DOC_STATUS_LABELS, DOC_STATUSES } from "@/server/queries/completeness";
import { isRefusal } from "@/server/queries/people";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function href(p: { status?: string | null; area?: string | null }): string {
  const q = new URLSearchParams();
  if (p.status) q.set("status", p.status);
  if (p.area) q.set("area", p.area);
  const s = q.toString();
  return s ? `/evidence/completeness?${s}` : "/evidence/completeness";
}

function FilterChip({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link href={href} className={`rounded-full border px-2.5 py-0.5 ${active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100"}`}>
      {label}
    </Link>
  );
}

/** Completeness: where every document, page and area stands at the replay clock, with batch actions and their undo. */
export default async function CompletenessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSessionContext();
  const sp = await searchParams;
  const v = await completenessView(ctx, { status: one(sp.status), area: one(sp.area) });
  if (isRefusal(v)) {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Completeness</h1>
        <p className="text-sm text-stone-600">{v.message}</p>
      </div>
    );
  }
  const f = v.filters;
  const accounted = v.counts.used + v.counts.superseded + v.counts.dispositioned;
  const undecided = v.applicability.filter((a) => a.applies === null).length;

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs text-stone-500">
          <Link href="/evidence" className="hover:underline">
            Evidence
          </Link>{" "}
          / Completeness
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Completeness</h1>
        <p className="mt-1 text-sm text-stone-600">
          At the replay clock <span className="num">{dateOnly(v.asOf)}</span>, <span className="num">{v.total - v.counts.not_yet_available}</span> of <span className="num">{v.total}</span> documents have arrived; <span className="num">{accounted}</span> are
          accounted for (used by the engine in {v.version}, superseded, or given a disposition) and <span className="num">{v.counts.unaccounted}</span> are not. The firm&apos;s required step &quot;All documents accounted for&quot; passes only when that number is
          zero.
        </p>
      </section>

      <section className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-stone-500">Status:</span>
        <FilterChip active={!f.status} href={href({ area: f.area })} label={`all ${v.total}`} />
        {DOC_STATUSES.map((s) => (
          <FilterChip key={s} active={f.status === s} href={href({ status: s, area: f.area })} label={`${DOC_STATUS_LABELS[s]} ${v.counts[s]}`} />
        ))}
        <span className="ml-4 text-stone-500">Area:</span>
        <FilterChip active={!f.area} href={href({ status: f.status })} label="all areas" />
        {v.areas.map((a) => (
          <FilterChip key={a.id} active={f.area === a.id} href={href({ status: f.status, area: a.id })} label={`${a.label} ${a.count}`} />
        ))}
      </section>

      <CompletenessTable documents={v.documents} pages={v.pages} revision={v.revision} canRecord={v.actor.canDisposition} actorRole={v.actor.role} dispositions={v.dispositions} />

      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="font-medium">Batches in force</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          A batch disposition is undone as one unit. Undo refuses when a colleague has since recorded a disposition on any of the same items, so it never removes someone else&apos;s later work; undo your own batches, or any batch with the reviewer&apos;s
          undo permission.
        </p>
        <div className="mt-3">
          <BatchList batches={v.batches} revision={v.revision} />
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Area applicability</h2>
          <p className="mt-0.5 text-xs text-stone-500">
            For each review area, record whether it applies to this return. <span className="num">{undecided}</span> of {v.applicability.length} undecided. An area marked not applicable still keeps its lines; the mark is a reviewed statement that nothing in
            it needs work, with the reason.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="px-5 py-2 font-normal">Area</th>
              <th className="px-2 py-2 font-normal">Decision in force</th>
              <th className="px-2 py-2 font-normal">Record</th>
            </tr>
          </thead>
          <tbody>
            {v.applicability.map((a) => (
              <tr key={a.id} className="border-t border-stone-100 align-top">
                <td className="px-5 py-2">
                  <Link href={`/review?area=${encodeURIComponent(a.id)}`} className="font-medium hover:underline">
                    {a.label}
                  </Link>
                  <div className="text-xs text-stone-500">{a.description}</div>
                </td>
                <td className="px-2 py-2 text-xs">
                  {a.disposition ? (
                    <div>
                      <span className={`rounded px-1.5 py-0.5 ${a.applies ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-700"}`}>{a.applies ? "applies" : "not applicable"}</span>
                      <span className="ml-2 text-stone-500">
                        {a.disposition.actor.name}, revision <span className="num">{a.disposition.createdRevision}</span>
                      </span>
                      {a.disposition.note ? <div className="mt-0.5 text-stone-600">{a.disposition.note}</div> : null}
                    </div>
                  ) : (
                    <span className="text-stone-400">undecided</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <AreaApplicabilityForm areaId={a.id} areaLabel={a.label} revision={v.revision} canRecord={v.actor.canDisposition} current={a.applies} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-5 py-3">
          <div>
            <h2 className="font-medium">Outside filings</h2>
            <p className="mt-0.5 text-xs text-stone-500">
              Filings that are not part of this return (FBAR, Forms 1099-NEC, the 2023 Form 3520 question) are tracked as tasks so completeness covers them too. Full list on the{" "}
              <Link href="/people/tasks?kind=outside_filing" className="text-blue-700 hover:underline">
                tasks page
              </Link>
              .
            </p>
          </div>
          <TaskCreateForm
            revision={v.revision}
            canCreate={v.actor.canCreateTask}
            actorRole={v.actor.role}
            owners={v.owners}
            areas={v.allAreas}
            defaults={{ kind: "outside_filing", refs: ["F8938.1.max"] }}
            buttonLabel="New outside filing task"
          />
        </div>
        {v.outsideFilings.length === 0 ? (
          <p className="px-5 py-4 text-sm text-stone-500">No outside filing tasks yet. The engine flags the FBAR (F8938.1.max) and the contractor Forms 1099-NEC (SchC.I); create a task for each.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-5 py-2 font-normal">Task</th>
                <th className="px-2 py-2 font-normal">Owner</th>
                <th className="px-2 py-2 font-normal">Due</th>
                <th className="px-2 py-2 font-normal">Status</th>
                <th className="px-2 py-2 font-normal">References</th>
              </tr>
            </thead>
            <tbody>
              {v.outsideFilings.map((x) => (
                <tr key={x.id} className="border-t border-stone-100 align-top">
                  <td className="px-5 py-2">
                    <Link href={`/people/tasks#${x.id}`} className="font-medium hover:underline">
                      {x.title}
                    </Link>
                    <div className="text-xs text-stone-600">{x.detail}</div>
                  </td>
                  <td className="px-2 py-2 text-xs">{x.owner.name}</td>
                  <td className={`num px-2 py-2 text-xs whitespace-nowrap ${x.overdue ? "font-medium text-red-700" : ""}`}>{x.dueAt ? dateOnly(x.dueAt) : "none"}</td>
                  <td className="px-2 py-2 text-xs">
                    {x.status}
                    {x.overdue ? <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-red-800">overdue</span> : null}
                  </td>
                  <td className="px-2 py-2">
                    <RefInline items={x.refs} />
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
