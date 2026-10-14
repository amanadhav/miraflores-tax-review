import { RefInline } from "@/components/line-refs";
import { AdjustmentStatusBadge, formatLineValue, LineStatusBadge } from "@/components/line-value";
import { RefLink } from "@/components/ref-link";
import { Amount, LineName, Panel, RecordsHeader, Statement } from "@/components/records-shared";
import { bridgeView, type BridgeCorrection } from "@/server/queries/records-a";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function signedText(n: number | null): string {
  if (n === null) return "";
  const text = formatLineValue(Math.abs(n));
  return n < 0 ? `-${text}` : n > 0 ? `+${text}` : "0";
}

const KIND_TONE: Record<string, string> = {
  start: "bg-stone-100 text-stone-700",
  income: "bg-blue-100 text-blue-800",
  difference: "bg-amber-100 text-amber-800",
  add_back: "bg-amber-100 text-amber-800",
  tax_only: "bg-emerald-100 text-emerald-800",
  result: "bg-stone-900 text-white",
};

function CorrectionList({ items, empty }: { items: BridgeCorrection[]; empty: string }) {
  if (items.length === 0) return <p className="text-xs text-stone-400">{empty}</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((a) => (
        <li key={a.id} className="rounded border border-stone-100 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <AdjustmentStatusBadge status={a.status} />
            <LineName cell={{ key: a.targetRef, label: a.label, form: "", line: "" }} />
            <span className="num text-stone-500">{formatLineValue(a.priorValue)}</span>
            <span className="text-xs text-stone-400">to</span>
            <span className="num font-medium">{formatLineValue(a.proposedValue)}</span>
          </div>
          <p className="mt-1 text-xs text-stone-600">{a.reason}</p>
          <p className="mt-0.5 text-[11px] text-stone-500">
            <RefLink refId={`adjustment:${a.id}`} label={a.id} /> by {a.author.name} at revision <span className="num">{a.createdRevision}</span>
            {a.decidedBy ? (
              <>
                , {a.status} by {a.decidedBy.name} at revision <span className="num">{a.decidedRevision}</span>
              </>
            ) : null}
            . Estimated effect: federal <span className="num">{a.effectFederal === null ? "unknown" : signedText(a.effectFederal)}</span>, California{" "}
            <span className="num">{a.effectCalifornia === null ? "unknown" : signedText(a.effectCalifornia)}</span> ({a.effectStatus.replace(/_/g, " ")}).
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Books to tax: the client's profit and loss reconciled to the effective Schedule C profit. */
export default async function BridgePage() {
  const ctx = await requireSessionContext();
  const v = await bridgeView(ctx);

  return (
    <div className="space-y-6">
      <RecordsHeader
        current="bridge"
        title="Books to tax bridge"
        intro="A signed reconciliation from the client's profit and loss to the effective Schedule C net profit, built from the packet's own links. Each row names the return line it reaches and the evidence behind it."
        meta={v}
      />

      <Statement tone={v.agrees ? "emerald" : "amber"}>
        <span className="font-medium">{v.agrees ? "Agrees." : "Unexplained difference."}</span> {v.agreement}
      </Statement>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel id="rows" title="Reconciliation" hint="Amounts are the signed effect on profit. Books amounts come from the profit and loss; return amounts are the effective values of the lines named.">
          <p className="mb-2 text-xs text-stone-600">
            Books: <RefLink refId={v.books.ref} label={v.books.label} className="text-xs text-blue-700 hover:underline" /> <span className="num text-stone-400">{v.books.ref}</span>. Transaction detail:{" "}
            <RefLink refId={v.transactions.ref} label={v.transactions.label} className="text-xs text-blue-700 hover:underline" /> <span className="num text-stone-400">{v.transactions.ref}</span>.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="px-3 py-2 font-normal">Step</th>
                  <th className="px-3 py-2 font-normal">Item</th>
                  <th className="px-3 py-2 text-right font-normal">Books</th>
                  <th className="px-3 py-2 text-right font-normal">Return</th>
                  <th className="px-3 py-2 text-right font-normal">Effect on profit</th>
                  <th className="px-3 py-2 font-normal">Line</th>
                  <th className="px-3 py-2 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {v.rows.map((r, i) => (
                  <tr key={i} className={`border-t border-stone-100 align-top ${r.kind === "result" ? "bg-stone-50 font-medium" : ""}`}>
                    <td className="px-3 py-1.5">
                      <span className={`rounded px-2 py-0.5 text-xs font-normal ${KIND_TONE[r.kind]}`}>{r.kindLabel}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <div>{r.label}</div>
                      <div className="mt-0.5 text-[11px] font-normal text-stone-500">{r.explanation}</div>
                      <div className="mt-0.5 font-normal">
                        <RefInline items={r.evidence} />
                      </div>
                    </td>
                    <td className="num px-3 py-1.5 text-right whitespace-nowrap text-stone-600">{r.booksAmount === null ? "" : formatLineValue(r.booksAmount)}</td>
                    <td className="num px-3 py-1.5 text-right whitespace-nowrap text-stone-600">{r.taxAmount === null ? "" : formatLineValue(r.taxAmount)}</td>
                    <td className="num px-3 py-1.5 text-right whitespace-nowrap">{r.kind === "start" || r.kind === "result" ? formatLineValue(r.amount) : signedText(r.amount)}</td>
                    <td className="px-3 py-1.5 text-xs font-normal">
                      {r.line ? (
                        <span>
                          <LineName cell={r.line} /> <Amount value={r.line.effective} />
                        </span>
                      ) : (
                        <span className="text-stone-400">no line</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-normal">{r.status ? <LineStatusBadge status={r.status} reason={r.statusReason ?? `${r.label} is ${r.status}`} /> : null}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-stone-200 text-xs">
                  <td className="px-3 py-2 text-stone-600" colSpan={4}>
                    Bridge result <span className="num">{formatLineValue(v.computedProfit)}</span> against effective Schedule C line 31{" "}
                    <span className="num">{v.effectiveProfit === null ? "unknown" : formatLineValue(v.effectiveProfit)}</span> ({v.profitStatus})
                  </td>
                  <td className={`num px-3 py-2 text-right ${v.agrees ? "text-emerald-700" : "text-amber-800"}`}>{v.agrees ? "0" : signedText(v.unexplained)}</td>
                  <td className="px-3 py-2 text-stone-500" colSpan={2}>
                    {v.agrees ? "agrees" : "unexplained difference"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>

        <Panel id="corrections" title="Schedule C corrections" hint="Why the bridge moves: accepted corrections change the return side now; proposed ones wait for a decision.">
          <Statement tone={v.corrections.proposed.length > 0 ? "amber" : "stone"}>{v.corrections.statement}</Statement>
          <h3 className="mt-3 text-xs font-medium tracking-wide text-stone-500 uppercase">Accepted ({v.corrections.accepted.length})</h3>
          <div className="mt-1">
            <CorrectionList items={v.corrections.accepted} empty="None accepted." />
          </div>
          <h3 className="mt-3 text-xs font-medium tracking-wide text-stone-500 uppercase">Proposed ({v.corrections.proposed.length})</h3>
          <div className="mt-1">
            <CorrectionList items={v.corrections.proposed} empty="None proposed." />
          </div>
          {v.corrections.other.length > 0 ? (
            <>
              <h3 className="mt-3 text-xs font-medium tracking-wide text-stone-500 uppercase">Rejected, superseded or reverted ({v.corrections.other.length})</h3>
              <div className="mt-1">
                <CorrectionList items={v.corrections.other} empty="" />
              </div>
            </>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
