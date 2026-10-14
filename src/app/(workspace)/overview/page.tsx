import Link from "next/link";
import { money, signed } from "@/lib/format";
import { requireSessionContext } from "@/server/request";
import { loadOverview } from "@/server/queries/overview";

export const dynamic = "force-dynamic";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className="num text-lg font-medium">{value}</div>
      {hint ? <div className="text-xs text-stone-500">{hint}</div> : null}
    </div>
  );
}

export default async function OverviewPage() {
  const ctx = await requireSessionContext();
  const o = await loadOverview(ctx);
  const fed = o.baseline.federal;
  const ca = o.baseline.california;
  const v = o.state.version;
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">{ctx.workspace.name}</h1>
        <p className="mt-1 text-sm text-stone-600">
          Engine baseline {v.version}, computed {v.computed_at.slice(0, 10)}: {v.trigger}
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="font-medium">Engine baseline (immutable)</h2>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <Stat label="Federal AGI" value={money(fed.agi)} />
            <Stat label="Federal total tax" value={money(fed.total_tax)} />
            <Stat label="Federal payments" value={money(fed.payments)} />
            <Stat label="Federal balance due" value={money(fed.balance_due)} hint={`penalty ${money(fed.penalty)}`} />
            <Stat label="California AGI" value={money(ca.ca_agi)} hint={`total AGI ${money(ca.total_agi)}`} />
            <Stat label="California total tax" value={money(ca.total_tax)} />
            <Stat label="California payments" value={money(ca.payments)} />
            <Stat label="California balance due" value={money(ca.balance_due)} hint="negative is an overpayment" />
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="font-medium">Accepted workpaper changes</h2>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <Stat label="Accepted changes" value={String(o.effect.count)} hint={`${o.proposals} awaiting decision`} />
            <Stat label="Lines recomputed / stale" value={`${o.state.effective.recomputedKeys.length} / ${o.state.effective.staleKeys.length}`} hint="stale lines need review" />
            <Stat label="Estimated federal tax effect" value={signed(o.effect.federal)} hint="at supplied per-dollar rates" />
            <Stat label="Estimated California tax effect" value={signed(o.effect.california)} hint="at supplied per-dollar rates" />
            <Stat label="Federal balance due effect" value={signed(o.effect.balanceFederal)} />
            <Stat label="California balance due effect" value={signed(o.effect.balanceCalifornia)} />
          </div>
          <p className="mt-3 text-xs text-stone-500">
            Estimates, not a recomputed return. The engine cannot be rerun here; {o.effect.unknownCount > 0 ? `${o.effect.unknownCount} change(s) have an unknown effect; ` : ""}
            {o.effect.limitations.length} limitation(s) are recorded on the changes themselves. No corrected final tax is claimed.
          </p>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="font-medium">Blocking filing</h2>
          {o.blockers.length === 0 ? (
            <p className="mt-3 text-sm text-stone-600">No open findings block filing.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {o.blockers.slice(0, 6).map((f) => (
                <li key={f.id}>
                  <Link href={`/review?area=${f.area}#${f.id}`} className="font-medium hover:underline">
                    {f.title}
                  </Link>
                  <span className="ml-2 text-xs text-stone-500">{f.origin === "engine_diagnostic" ? "engine" : "reviewer"}</span>
                </li>
              ))}
              {o.blockers.length > 6 ? <li className="text-xs text-stone-500">and {o.blockers.length - 6} more</li> : null}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Review areas</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="px-5 py-2 font-normal">Area</th>
              <th className="px-2 py-2 font-normal">Lines</th>
              <th className="px-2 py-2 font-normal">Open findings</th>
              <th className="px-2 py-2 font-normal">Proposed</th>
              <th className="px-2 py-2 font-normal">Accepted</th>
              <th className="px-2 py-2 font-normal">Stale</th>
              <th className="px-2 py-2 font-normal">Preparer</th>
              <th className="px-2 py-2 font-normal">Reviewer</th>
              <th className="px-2 py-2 font-normal">Partner</th>
            </tr>
          </thead>
          <tbody>
            {o.areas.map((a) => (
              <tr key={a.id} className="border-t border-stone-100">
                <td className="px-5 py-2">
                  <Link href={`/review?area=${a.id}`} className="font-medium hover:underline">
                    {a.label}
                  </Link>
                </td>
                <td className="num px-2 py-2">{a.lines}</td>
                <td className="num px-2 py-2">
                  {a.openFindings}
                  {a.blockers ? <span className="ml-1 text-xs text-red-600">({a.blockers} block filing)</span> : null}
                </td>
                <td className="num px-2 py-2">{a.proposals}</td>
                <td className="num px-2 py-2">{a.accepted}</td>
                <td className="num px-2 py-2">{a.stale}</td>
                {(["preparer", "reviewer", "partner"] as const).map((level) => (
                  <td key={level} className="px-2 py-2">
                    <SignBadge status={a.signoffs[level]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function SignBadge({ status }: { status: "active" | "stale" | "none" }) {
  if (status === "active") return <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">signed</span>;
  if (status === "stale") return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">reopened</span>;
  return <span className="text-xs text-stone-400">none</span>;
}
