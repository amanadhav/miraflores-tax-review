import Link from "next/link";
import { LogTimeForm } from "@/components/time-form";
import { dateOnly } from "@/lib/format";
import { isRefusal, timeView } from "@/server/queries/people";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function hours(n: number | null): string {
  if (n === null) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

/** Hours logged by area against the firm's budget, with the engagement's status line. */
export default async function TimePage() {
  const ctx = await requireSessionContext();
  const v = await timeView(ctx);
  if (isRefusal(v)) return <p className="text-sm text-stone-600">{v.message}</p>;
  const s = v.status;
  const over = v.budget.rows.filter((r) => r.over);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Time</h1>
        <p className="mt-1 text-sm text-stone-600">
          Engagement status: <span className="font-medium">{s.workflowState.replace(/_/g, " ")}</span>
          {s.filingLocked ? " (frozen for filing)" : ""}, return {s.activeVersion}, clock <span className="num">{dateOnly(s.asOf)}</span>.{" "}
          <Link href="/review" className="hover:underline">
            <span className="num">{s.openFindings}</span> open findings
          </Link>
          {s.blockers > 0 ? ` (${s.blockers} block filing)` : ""},{" "}
          <Link href="/people/requests?status=open" className="hover:underline">
            <span className="num">{s.openRequests}</span> open requests
          </Link>
          {s.overdueRequests > 0 ? <span className="text-red-700"> ({s.overdueRequests} overdue)</span> : null},{" "}
          <Link href="/people/tasks?status=open" className="hover:underline">
            <span className="num">{s.openTasks}</span> open tasks
          </Link>
          {s.overdueTasks > 0 ? <span className="text-red-700"> ({s.overdueTasks} overdue)</span> : null}.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
            <h2 className="font-medium">Hours by area against budget</h2>
            {over.length > 0 ? <span className="text-xs text-red-700">{over.length} area(s) over budget</span> : <span className="text-xs text-stone-500">no area over budget</span>}
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-5 py-2 font-normal">Area</th>
                <th className="px-2 py-2 text-right font-normal">Budget</th>
                <th className="px-2 py-2 text-right font-normal">Logged</th>
                <th className="px-2 py-2 text-right font-normal">Remaining</th>
                <th className="px-2 py-2 text-right font-normal">Used</th>
                <th className="px-5 py-2 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {v.budget.rows.map((r) => (
                <tr key={r.areaId} className={`border-t border-stone-100 ${r.over ? "bg-red-50/50" : ""}`}>
                  <td className="px-5 py-1.5">{r.label}</td>
                  <td className="num px-2 py-1.5 text-right">{r.budget === null ? <span className="text-stone-400">none</span> : `${hours(r.budget)} h`}</td>
                  <td className="num px-2 py-1.5 text-right">{hours(r.logged)} h</td>
                  <td className={`num px-2 py-1.5 text-right ${r.over ? "font-medium text-red-700" : ""}`}>{r.remaining === null ? "" : `${hours(r.remaining)} h`}</td>
                  <td className="num px-2 py-1.5 text-right">{r.percent === null ? "" : `${r.percent}%`}</td>
                  <td className="px-5 py-1.5">{r.over ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">over budget</span> : null}</td>
                </tr>
              ))}
              <tr className="border-t border-stone-200 font-medium">
                <td className="px-5 py-1.5">Total</td>
                <td className="num px-2 py-1.5 text-right">{hours(v.budget.totalBudget)} h</td>
                <td className="num px-2 py-1.5 text-right">{hours(v.budget.totalLogged)} h</td>
                <td className={`num px-2 py-1.5 text-right ${v.budget.totalRemaining < 0 ? "text-red-700" : ""}`}>{hours(v.budget.totalRemaining)} h</td>
                <td className="num px-2 py-1.5 text-right">{v.budget.totalBudget > 0 ? `${Math.round((v.budget.totalLogged / v.budget.totalBudget) * 100)}%` : ""}</td>
                <td />
              </tr>
            </tbody>
          </table>
          <p className="px-5 py-2 text-xs text-stone-500">Budgets come from the packet&apos;s firm settings. Tax computation and payments has no budget of its own; hours logged there count in the total.</p>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="font-medium">Log time</h2>
          <p className="mt-0.5 text-xs text-stone-500">Logged as {v.actor.name}. Time can be logged even once the return is frozen for filing.</p>
          <div className="mt-3">
            <LogTimeForm revision={v.revision} canLog={v.actor.canLog} actorRole={v.actor.role} areas={v.areas} defaultDate={v.defaultDate} />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Entries</h2>
          <span className="text-xs text-stone-500">{v.entries.length} entries</span>
        </div>
        {v.entries.length === 0 ? (
          <p className="px-5 py-4 text-sm text-stone-500">No time logged yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-5 py-2 font-normal">Person</th>
                <th className="px-2 py-2 font-normal">Date</th>
                <th className="px-2 py-2 font-normal">Area</th>
                <th className="px-2 py-2 text-right font-normal">Hours</th>
                <th className="px-2 py-2 font-normal">Note</th>
                <th className="px-5 py-2 text-right font-normal">Revision</th>
              </tr>
            </thead>
            <tbody>
              {v.entries.map((e) => (
                <tr key={e.id} className="border-t border-stone-100">
                  <td className="px-5 py-1.5">
                    {e.actor.name}
                    {e.mine ? <span className="text-xs text-stone-500"> (you)</span> : null}
                  </td>
                  <td className="num px-2 py-1.5">{e.workDate}</td>
                  <td className="px-2 py-1.5">{e.areaLabel}</td>
                  <td className="num px-2 py-1.5 text-right">{hours(e.hours)}</td>
                  <td className="px-2 py-1.5 text-xs text-stone-600">{e.note ?? ""}</td>
                  <td className="num px-5 py-1.5 text-right text-xs text-stone-500">{e.createdRevision}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
