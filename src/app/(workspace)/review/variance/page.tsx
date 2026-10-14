import { RefLink } from "@/components/ref-link";
import { Amount, LineName, Panel, RecordsHeader, Statement, StatusCell } from "@/components/records-shared";
import { VarianceTable } from "@/components/records-variance-table";
import { LineStatusBadge } from "@/components/line-value";
import { varianceView } from "@/server/queries/records-a";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

/** Prior-year variance: every line both returns share, flagged lines first, with explanations recorded as verifications. */
export default async function VariancePage() {
  const ctx = await requireSessionContext();
  const v = await varianceView(ctx);

  return (
    <div className="space-y-6">
      <RecordsHeader
        current="variance"
        title="Prior-year variance"
        intro="Each line the 2024 and 2025 returns share, compared under the firm's thresholds. A flagged line counts as explained once a verification agreed to the prior year is recorded on it."
        meta={v}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Statement tone="stone">
          <span className="font-medium">Thresholds.</span> {v.thresholds.statement}
        </Statement>
        <Statement tone="stone">
          <span className="font-medium">Zero prior amounts.</span> {v.zeroPriorNote}
        </Statement>
        <Statement tone={v.flaggedCount > v.explainedCount ? "amber" : "emerald"}>
          <span className="num font-medium">{v.flaggedCount}</span> flagged, <span className="num font-medium">{v.explainedCount}</span> explained,{" "}
          <span className="num font-medium">{v.flaggedCount - v.explainedCount}</span> still to explain. Required step: prior-year variances explained.
        </Statement>
      </div>

      <Panel id="rows" title="Lines in both years" count={v.rows.length} hint={`2024 values link to the extracted value on ${v.priorDocument.label}. Status is the 2025 line's workpaper status.`}>
        <VarianceTable rows={v.rows} revision={v.revision} canVerify={v.actor.canVerify} actorRole={v.actor.role} method={v.method} priorDocumentRef={v.priorDocument.ref} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="only-prior" title="Only on the 2024 return" count={v.onlyPrior.length} hint={v.californiaNote}>
          {v.onlyPrior.length === 0 ? (
            <p className="text-sm text-stone-500">Every 2024 line has a 2025 counterpart.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="px-2 py-1 font-normal">2024 line</th>
                  <th className="px-2 py-1 text-right font-normal">2024</th>
                  <th className="px-2 py-1 font-normal">This year</th>
                </tr>
              </thead>
              <tbody>
                {v.onlyPrior.map((r) => (
                  <tr key={r.key} className="border-t border-stone-100 align-top">
                    <td className="px-2 py-1">
                      <RefLink refId={`py:/return_2024/lines/${r.key}`} label={r.label} className="text-sm hover:underline" />
                      <div className="num text-[11px] text-stone-500">{r.key}</div>
                    </td>
                    <td className="num px-2 py-1 text-right whitespace-nowrap">
                      <Amount value={r.prior} />
                    </td>
                    <td className="px-2 py-1 text-xs text-stone-600">
                      {r.note}
                      {r.equivalent ? (
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          <LineName cell={r.equivalent} />
                          <Amount value={r.equivalent.effective} />
                          <StatusCell cell={r.equivalent} />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel id="only-current" title="Only on the 2025 return" count={v.onlyCurrent.length} hint={`Lines over ${v.thresholds.amount} with no 2024 counterpart (Form 8949 lots left out). New this year, so there is no change to flag; the line inspector shows their evidence.`}>
          {v.onlyCurrent.length === 0 ? (
            <p className="text-sm text-stone-500">No new lines over the amount threshold.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="px-2 py-1 font-normal">Line</th>
                  <th className="px-2 py-1 text-right font-normal">2025 effective</th>
                  <th className="px-2 py-1 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {v.onlyCurrent.map((r) => (
                  <tr key={r.key} className="border-t border-stone-100 align-top">
                    <td className="px-2 py-1">
                      <LineName cell={{ key: r.key, label: r.label, form: "", line: "" }} />
                    </td>
                    <td className="num px-2 py-1 text-right whitespace-nowrap">
                      <Amount value={r.current} />
                    </td>
                    <td className="px-2 py-1">{r.status ? <LineStatusBadge status={r.status} reason={`${r.label} is ${r.status}`} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
