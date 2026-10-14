import { RefLink } from "@/components/ref-link";
import { Amount, LineName, Panel, RecordsHeader, Statement, StatusCell } from "@/components/records-shared";
import { formatLineValue } from "@/components/line-value";
import { money } from "@/lib/format";
import { summaryView, type HeadlineRow } from "@/server/queries/records-a";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

const ENGINE_LABELS: Record<string, string> = {
  agi: "Adjusted gross income",
  taxable_income: "Taxable income",
  total_tax: "Total tax",
  payments: "Payments",
  balance_due: "Balance due (negative is an overpayment)",
  penalty: "Underpayment penalty",
  total_agi: "Total AGI using California law",
  ca_agi: "California AGI",
};

function signedText(n: number | null): string {
  if (n === null) return "";
  const text = formatLineValue(Math.abs(n));
  return n < 0 ? `-${text}` : n > 0 ? `+${text}` : "0";
}

function EngineBlock({ title, totals }: { title: string; totals: Record<string, number> }) {
  return (
    <div>
      <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">{title}</h3>
      <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {Object.entries(totals).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-stone-600">
              {ENGINE_LABELS[k] ?? k.replace(/_/g, " ")} <span className="num text-[11px] text-stone-400">{k}</span>
            </dt>
            <dd className="num text-right">{money(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function HeadlineTable({ rows }: { rows: HeadlineRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="px-3 py-2 font-normal">Line</th>
            <th className="px-3 py-2 text-right font-normal">2024 as filed</th>
            <th className="px-3 py-2 text-right font-normal">Baseline</th>
            <th className="px-3 py-2 text-right font-normal">Effective</th>
            <th className="px-3 py-2 font-normal">Status</th>
            <th className="px-3 py-2 text-right font-normal">Change</th>
            <th className="px-3 py-2 text-right font-normal">Percent</th>
            <th className="px-3 py-2 font-normal">Variance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const changed = r.baseline !== r.effective;
            return (
              <tr key={r.key} className={`border-t border-stone-100 align-top ${r.change?.flagged && !r.explained ? "bg-amber-50/60" : ""}`}>
                <td className="px-3 py-1.5">
                  <LineName cell={r} />
                  {r.prior?.note ? <div className="mt-0.5 text-[11px] text-stone-500">{r.prior.note}</div> : null}
                </td>
                <td className="num px-3 py-1.5 text-right whitespace-nowrap text-stone-600">
                  {r.prior ? (
                    <span>
                      {r.prior.source ? (
                        <RefLink refId={r.prior.source.ref} label={formatLineValue(r.prior.display)} className="num text-blue-700 hover:underline" />
                      ) : (
                        formatLineValue(r.prior.display)
                      )}
                      <div className="text-[11px] text-stone-400">
                        {r.prior.label} <span className="num">{r.prior.key}</span>
                      </div>
                    </span>
                  ) : (
                    <span className="text-xs text-stone-400">no 2024 line</span>
                  )}
                </td>
                <td className="num px-3 py-1.5 text-right whitespace-nowrap text-stone-500">{formatLineValue(r.baseline)}</td>
                <td className={`num px-3 py-1.5 text-right whitespace-nowrap ${changed ? "font-medium" : ""}`}>{formatLineValue(r.effective)}</td>
                <td className="px-3 py-1.5">
                  <StatusCell cell={r} />
                </td>
                <td className="num px-3 py-1.5 text-right whitespace-nowrap">{r.change ? signedText(r.change.delta) : <span className="text-xs text-stone-400">not compared</span>}</td>
                <td className="num px-3 py-1.5 text-right whitespace-nowrap">{r.change ? r.change.percent === null ? <span className="text-xs text-stone-400">no prior amount</span> : `${r.change.percent}%` : ""}</td>
                <td className="px-3 py-1.5 text-xs">
                  {r.change?.flagged ? (
                    r.explained ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">flagged, explained</span>
                    ) : (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">flagged</span>
                    )
                  ) : r.change ? (
                    <span className="text-stone-400">under threshold</span>
                  ) : null}
                  {r.change ? <div className="mt-0.5 text-[11px] text-stone-500">{r.change.reason}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The return summary versus last year, then every computed line by form. */
export default async function SummaryPage() {
  const ctx = await requireSessionContext();
  const v = await summaryView(ctx);
  const lineCount = v.forms.reduce((n, f) => n + f.lines.length, 0);
  const lotsSkipped = v.forms.reduce((n, f) => n + f.lotsSkipped, 0);

  return (
    <div className="space-y-6">
      <RecordsHeader
        current="summary"
        title="Return summary versus last year"
        intro="The engine's totals as supplied, the workpaper's accepted changes with their estimated effects, the headline lines beside the 2024 return as filed, and every computed line by form."
        meta={v}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="engine" title={`Engine totals, ${v.version}`} hint={v.trigger}>
          <div className="grid gap-4 sm:grid-cols-2">
            <EngineBlock title="Federal" totals={v.engine.federal} />
            <EngineBlock title="California" totals={v.engine.california} />
          </div>
          <div className="mt-3">
            <Statement tone="stone">{v.engine.statement}</Statement>
          </div>
        </Panel>

        <Panel id="accepted" title="Accepted changes with estimated effects" count={v.accepted.length} hint="Listed separately from the engine totals. Each effect is an estimate at the version's per-dollar rate; nothing here is a recomputed return.">
          {v.accepted.length === 0 ? (
            <p className="text-sm text-stone-500">{v.estimates.statement}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-stone-500">
                  <tr>
                    <th className="px-2 py-1 font-normal">Line</th>
                    <th className="px-2 py-1 text-right font-normal">From</th>
                    <th className="px-2 py-1 text-right font-normal">To</th>
                    <th className="px-2 py-1 text-right font-normal">Est. federal tax</th>
                    <th className="px-2 py-1 text-right font-normal">Est. California tax</th>
                    <th className="px-2 py-1 font-normal">Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {v.accepted.map((a) => (
                    <tr key={a.id} className="border-t border-stone-100 align-top">
                      <td className="px-2 py-1">
                        <LineName cell={{ key: a.targetRef, label: a.label, form: "", line: "" }} />
                        <div className="text-[11px] text-stone-500">
                          <RefLink refId={`adjustment:${a.id}`} label={a.id} /> by {a.author.name}
                          {a.decidedBy ? `, accepted by ${a.decidedBy.name} at revision ${a.decidedRevision ?? ""}` : ""}
                        </div>
                      </td>
                      <td className="num px-2 py-1 text-right whitespace-nowrap text-stone-500">{formatLineValue(a.priorValue)}</td>
                      <td className="num px-2 py-1 text-right whitespace-nowrap font-medium">{formatLineValue(a.proposedValue)}</td>
                      <td className="num px-2 py-1 text-right whitespace-nowrap">{a.effectFederal === null ? <span className="text-xs text-stone-400">unknown</span> : signedText(a.effectFederal)}</td>
                      <td className="num px-2 py-1 text-right whitespace-nowrap">{a.effectCalifornia === null ? <span className="text-xs text-stone-400">unknown</span> : signedText(a.effectCalifornia)}</td>
                      <td className="px-2 py-1 text-[11px] text-stone-500">
                        <span className="rounded bg-stone-100 px-1.5 py-0.5">{a.effectStatus.replace(/_/g, " ")}</span> {a.categoryLabel ?? ""}
                        {a.effectBasis ? <div>{a.effectBasis}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {v.estimates.complete ? (
                  <tfoot>
                    <tr className="border-t border-stone-200 text-xs">
                      <td className="px-2 py-1 text-stone-600" colSpan={3}>
                        Sum of estimates (balance due: federal {signedText(v.estimates.balanceFederal)}, California {signedText(v.estimates.balanceCalifornia)})
                      </td>
                      <td className="num px-2 py-1 text-right">{signedText(v.estimates.federal)}</td>
                      <td className="num px-2 py-1 text-right">{signedText(v.estimates.california)}</td>
                      <td className="px-2 py-1 text-stone-500">estimate, not a recomputed total</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
              <div className="mt-2">
                <Statement tone="amber">{v.estimates.statement}</Statement>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        id="headline"
        title="Headline lines versus 2024"
        hint={`2024 values come from the return as filed (${v.priorReturn.document.label}, prepared by ${v.priorReturn.preparedBy}, filed ${v.priorReturn.filed}, ${v.priorReturn.residency}); each links to the extracted value on that document. Flags use the firm standard: over ${v.thresholds.percent}% and over ${v.thresholds.amount}.`}
      >
        <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Federal, Form 1040</h3>
        <HeadlineTable rows={v.federalHeadline} />
        <h3 className="mt-5 text-xs font-medium tracking-wide text-stone-500 uppercase">California, Form 540NR against the 2024 Form 540</h3>
        <p className="mt-1 text-xs text-stone-600">{v.californiaNote}</p>
        <HeadlineTable rows={v.californiaHeadline} />
      </Panel>

      <Panel id="computation" title="Tax computation" count={`${lineCount} lines in ${v.forms.length} forms`} hint={`Every line of ${v.version} in packet order, grouped by form, with its rule and the formula this workpaper verified (or opaque when it could not). ${lotsSkipped} Form 8949 lot lines are left out; their box totals are kept.`}>
        <nav className="flex flex-wrap gap-2 text-xs" aria-label="Form index">
          {v.forms.map((f) => (
            <a key={f.form} href={`#form-${f.form}`} className="rounded border border-stone-200 bg-white px-2 py-1 text-stone-700 hover:bg-stone-50">
              {f.label} <span className="num text-stone-400">{f.lines.length}</span>
            </a>
          ))}
        </nav>
        <div className="mt-4 space-y-5">
          {v.forms.map((f) => (
            <section key={f.form} id={`form-${f.form}`}>
              <h3 className="flex flex-wrap items-baseline gap-2 text-sm font-medium">
                {f.label}
                <span className="num text-[11px] font-normal text-stone-500">{f.form}</span>
                <span className="text-[11px] font-normal text-stone-500">{f.jurisdiction === "california" ? "California" : "federal"}</span>
                {f.lotsSkipped > 0 ? <span className="text-[11px] font-normal text-stone-500">{f.lotsSkipped} lots not listed</span> : null}
              </h3>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-stone-500">
                    <tr>
                      <th className="px-3 py-1.5 font-normal">Line</th>
                      <th className="px-3 py-1.5 text-right font-normal">Baseline</th>
                      <th className="px-3 py-1.5 text-right font-normal">Effective</th>
                      <th className="px-3 py-1.5 font-normal">Status</th>
                      <th className="px-3 py-1.5 font-normal">Rule</th>
                      <th className="px-3 py-1.5 font-normal">Formula</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.lines.map((l) => {
                      const changed = l.baseline !== l.effective;
                      return (
                        <tr key={l.key} id={l.key} className="border-t border-stone-100 align-top hover:bg-stone-50">
                          <td className="px-3 py-1">
                            <LineName cell={l} />
                          </td>
                          <td className="num px-3 py-1 text-right whitespace-nowrap text-stone-500">{formatLineValue(l.baseline)}</td>
                          <td className={`num px-3 py-1 text-right whitespace-nowrap ${changed ? "font-medium" : ""}`}>
                            <Amount value={l.effective} />
                          </td>
                          <td className="px-3 py-1">
                            <StatusCell cell={l} />
                          </td>
                          <td className="px-3 py-1 text-xs">
                            <span className="num" title={l.ruleText}>
                              {l.rule}
                            </span>
                          </td>
                          <td className="px-3 py-1 text-xs text-stone-600">
                            {l.reproducible ? l.formula : <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-600">opaque</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </Panel>
    </div>
  );
}
