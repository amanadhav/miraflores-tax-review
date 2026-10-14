import { RaiseFindingForm } from "@/components/finding-forms";
import { RefInline } from "@/components/line-refs";
import { formatLineValue } from "@/components/line-value";
import { RefLink } from "@/components/ref-link";
import { Amount, LineFact, LineTableCompact, Panel, RecordsHeader, Statement } from "@/components/records-shared";
import { ThirdPartyVerifyForm } from "@/components/records-verify";
import { areaLabel } from "@/domain/areas";
import { dateOnly } from "@/lib/format";
import { paymentsView, type JurisdictionPayments, type PaymentMatch, type RecordMatchStatus } from "@/server/queries/records-a";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<RecordMatchStatus, string> = {
  agrees: "matches",
  differs: "mismatch",
  missing: "not on the record",
  credited_elsewhere: "credited to another year",
  record_unavailable: "record not yet available",
};

const STATUS_TONE: Record<RecordMatchStatus, string> = {
  agrees: "bg-emerald-100 text-emerald-800",
  differs: "bg-red-100 text-red-800",
  missing: "bg-red-100 text-red-800",
  credited_elsewhere: "bg-amber-100 text-amber-800",
  record_unavailable: "bg-stone-100 text-stone-600",
};

function MatchBadge({ status }: { status: RecordMatchStatus }) {
  return <span className={`rounded px-2 py-0.5 text-xs ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

function MatchTable({ matches, recordName }: { matches: PaymentMatch[]; recordName: string }) {
  if (matches.length === 0) return <p className="text-sm text-stone-500">The engine lists no individual payments on this line.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="px-3 py-2 font-normal">Return counts</th>
            <th className="px-3 py-2 font-normal">Confirmation in the file</th>
            <th className="px-3 py-2 font-normal">{recordName}</th>
            <th className="px-3 py-2 font-normal">Match</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m, i) => (
            <tr key={i} className={`border-t border-stone-100 align-top ${m.record.status === "differs" || m.record.status === "missing" || m.record.status === "credited_elsewhere" ? "bg-amber-50/60" : ""}`}>
              <td className="px-3 py-1.5 whitespace-nowrap">
                <span className="num">{m.engine.date}</span> <Amount value={m.engine.amount} className="font-medium" />
              </td>
              <td className="px-3 py-1.5 text-xs">
                <span className={`rounded px-1.5 py-0.5 ${m.confirmation.kind === "document" ? "bg-stone-100 text-stone-700" : "bg-amber-100 text-amber-800"}`}>
                  {m.confirmation.kind === "document" ? "confirmation" : m.confirmation.kind === "client_answer" ? "client answer only" : "none"}
                </span>
                <div className="mt-0.5 text-stone-600">{m.confirmation.note}</div>
                <div className="mt-0.5">
                  <RefInline items={m.confirmation.refs} />
                </div>
              </td>
              <td className="px-3 py-1.5 text-xs">
                {m.record.date ? (
                  <span>
                    <span className="num">{m.record.date}</span> <Amount value={m.record.amount} />
                  </span>
                ) : null}
                <div className="mt-0.5 text-stone-600">{m.record.note}</div>
              </td>
              <td className="px-3 py-1.5">
                <MatchBadge status={m.record.status} />
                {m.record.difference !== null && m.record.difference !== 0 ? (
                  <div className="num mt-0.5 text-xs text-stone-600">difference {formatLineValue(m.record.difference)}</div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ j }: { j: JurisdictionPayments }) {
  const off = j.totals.difference !== null && j.totals.difference !== 0;
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-4">
      <div className="rounded border border-stone-200 p-2 text-sm">
        <div className="text-[11px] text-stone-500">Return counts</div>
        <Amount value={j.totals.engine} className="text-lg" />
      </div>
      <div className="rounded border border-stone-200 p-2 text-sm">
        <div className="text-[11px] text-stone-500">Confirmed in the file</div>
        <Amount value={j.totals.confirmed} className="text-lg" />
      </div>
      <div className="rounded border border-stone-200 p-2 text-sm">
        <div className="text-[11px] text-stone-500">On the agency record</div>
        {j.totals.recorded === null ? <span className="text-xs text-stone-400">not yet available</span> : <Amount value={j.totals.recorded} className="text-lg" />}
      </div>
      <div className={`rounded border p-2 text-sm ${off ? "border-amber-300 bg-amber-50" : "border-stone-200"}`}>
        <div className="text-[11px] text-stone-500">Difference</div>
        {j.totals.difference === null ? <span className="text-xs text-stone-400">cannot compare</span> : <Amount value={j.totals.difference} className={`text-lg ${off ? "font-medium text-amber-900" : ""}`} />}
      </div>
      <div className="sm:col-span-4">
        <Statement tone={j.totals.recorded === null ? "stone" : off ? "amber" : "emerald"}>{j.totals.statement}</Statement>
      </div>
    </div>
  );
}

function Actions({ j, revision, canVerify, canRaise, actorRole, owners, title }: { j: JurisdictionPayments; revision: number; canVerify: boolean; canRaise: boolean; actorRole: string; owners: { id: string; name: string; role: string }[]; title: string }) {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div>
        <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Agree {j.verify.subjectRef} to the agency record</h3>
        <div className="mt-1">
          <ThirdPartyVerifyForm target={j.verify} revision={revision} canVerify={canVerify} actorRole={actorRole} />
        </div>
      </div>
      <div>
        <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Raise a finding on {title}</h3>
        <div className="mt-1">
          <RaiseFindingForm areaId={j.area} areaLabel={areaLabel(j.area)} revision={revision} canRaise={canRaise} actorRole={actorRole} owners={owners} defaultRefs={j.findingRefs} />
        </div>
      </div>
    </div>
  );
}

/** Federal and California payments reconciled to the agency records available at the replay clock. */
export default async function PaymentsPage() {
  const ctx = await requireSessionContext();
  const v = await paymentsView(ctx);
  const f = v.federal;
  const c = v.california;

  return (
    <div className="space-y-6">
      <RecordsHeader
        current="payments"
        title="Payments reconciliation"
        intro="Each estimated payment the return counts, beside the confirmation in the file and the agency's own record at the replay clock. Withholding, extension payments and the underpayment penalty lines follow."
        meta={v}
      />

      <Statement tone="stone">
        <span className="font-medium">Payments change balance due, not tax.</span> {v.statement}
      </Statement>

      <Panel id="federal" title="Federal estimated payments" hint="EFTPS confirmations (D67) and the client's answer (qa-41) against the IRS account transcript snapshots that exist at the replay clock.">
        <div className="text-sm">
          <LineFact cell={f.line} />
          {f.line?.note ? <p className="mt-0.5 text-xs text-stone-500">Engine note: {f.line.note}</p> : null}
          {f.line ? (
            <p className="mt-0.5 text-xs text-stone-500">
              Rule <span className="num">{f.line.rule}</span>: {f.line.ruleText} Sources: <RefInline items={f.line.sources} />
            </p>
          ) : null}
        </div>
        <div className="mt-3">
          <MatchTable matches={f.matches} recordName="IRS transcript" />
        </div>
        {f.unmatchedRecords.length > 0 ? (
          <ul className="mt-2 text-xs text-stone-600">
            {f.unmatchedRecords.map((u, i) => (
              <li key={i}>
                On the transcript but not on the return: <span className="num">{u.date}</span> <Amount value={u.amount} />. {u.note}
              </li>
            ))}
          </ul>
        ) : null}
        <Totals j={f} />

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">IRS transcript snapshots</h3>
            <ul className="mt-1 space-y-2 text-sm">
              {f.transcripts.map((s) => (
                <li key={s.ref} className="rounded border border-stone-100 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <RefLink refId={s.ref} label={`Snapshot as of ${s.asOf}`} className="text-sm text-blue-700 hover:underline" />
                    <span className="num text-[11px] text-stone-400">{s.ref}</span>
                    {s.available ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-800">available</span>
                    ) : (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">arrives {dateOnly(s.link.availableAt)}; not usable at the replay clock</span>
                    )}
                  </div>
                  {s.available ? (
                    <table className="mt-1 w-full text-xs">
                      <tbody>
                        {s.transactions.map((x, i) => (
                          <tr key={i} className="border-t border-stone-100">
                            <td className="num py-0.5 pr-2">{x.date}</td>
                            <td className="num py-0.5 pr-2">{x.code}</td>
                            <td className="py-0.5 pr-2">{x.description}</td>
                            <td className="num py-0.5 text-right">{typeof x.amount === "number" ? formatLineValue(x.amount) : x.amount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="mt-1 text-xs text-stone-500">Payload hidden until the clock passes its as-of date.</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            <div>
              <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Extension payment</h3>
              <LineTableCompact cells={f.extension} showSources showRule={false} empty="No federal extension payment line." />
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-600">
                <MatchBadge status={f.extensionOnTranscript.status} /> {f.extensionOnTranscript.note}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Withholding</h3>
              <LineTableCompact cells={f.withholding} showSources showRule={false} empty="No federal withholding line." />
            </div>
            {f.clientAnswer ? (
              <p className="text-xs text-stone-600">
                <RefLink refId={f.clientAnswer.ref.ref} label={f.clientAnswer.id} /> {f.clientAnswer.question}: &quot;{f.clientAnswer.answer}&quot; ({f.clientAnswer.answeredBy}, {dateOnly(f.clientAnswer.answeredAt)})
              </p>
            ) : null}
          </div>
        </div>
        <Actions j={f} revision={v.revision} canVerify={v.actor.canVerify} canRaise={v.actor.canRaise} actorRole={v.actor.role} owners={v.owners} title="federal payments" />
      </Panel>

      <Panel id="california" title="California estimated payments" hint="FTB Web Pay confirmations (D68) against the FTB account record: 2025 payments and the September payment the FTB holds as a 2024 credit.">
        <div className="text-sm">
          <LineFact cell={c.line} />
          {c.line?.note ? <p className="mt-0.5 text-xs text-stone-500">Engine note: {c.line.note}</p> : null}
          {c.line ? (
            <p className="mt-0.5 text-xs text-stone-500">
              Rule <span className="num">{c.line.rule}</span>: {c.line.ruleText}
            </p>
          ) : null}
        </div>
        <div className="mt-3">
          <MatchTable matches={c.matches} recordName="FTB account" />
        </div>
        {c.unmatchedRecords.length > 0 ? (
          <ul className="mt-2 text-xs text-stone-600">
            {c.unmatchedRecords.map((u, i) => (
              <li key={i}>
                On the FTB record but not on the return: <span className="num">{u.date}</span> <Amount value={u.amount} />. {u.note}
              </li>
            ))}
          </ul>
        ) : null}
        <Totals j={c} />
        {c.creditedTo2024 > 0 ? (
          <div className="mt-2">
            <Statement tone="amber">
              <span className="num font-medium">{formatLineValue(c.creditedTo2024)}</span> paid 2025-09-15 was designated tax year 2024 on the Web Pay confirmation and the FTB holds it as a 2024 credit. The engine counted it
              because its rule takes every FTB payment dated 2025-04-01 through 2026-01-15; the return&apos;s line 72 is overstated by that amount unless the FTB reassigns it. Balance due moves, tax does not.
            </Statement>
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">FTB account record</h3>
            <p className="mt-1 text-sm">
              <RefLink refId={c.ftb.ref} label={c.ftb.link.label} className="text-sm text-blue-700 hover:underline" /> <span className="num text-[11px] text-stone-400">{c.ftb.ref}</span>
              {c.ftb.available ? (
                <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-800">as of {c.ftb.asOf}</span>
              ) : (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">arrives {dateOnly(c.ftb.link.availableAt)}</span>
              )}
            </p>
            {c.ftb.available ? (
              <table className="mt-1 w-full text-xs">
                <tbody>
                  {c.ftb.payments2025.map((p, i) => (
                    <tr key={`a${i}`} className="border-t border-stone-100">
                      <td className="num py-0.5 pr-2">{p.date}</td>
                      <td className="py-0.5 pr-2">tax year 2025 payment</td>
                      <td className="num py-0.5 text-right">{formatLineValue(p.amount)}</td>
                    </tr>
                  ))}
                  {c.ftb.payments2024AfterFiling.map((p, i) => (
                    <tr key={`b${i}`} className="border-t border-stone-100 bg-amber-50/60">
                      <td className="num py-0.5 pr-2">{p.date}</td>
                      <td className="py-0.5 pr-2">designated 2024{p.note ? `: ${p.note}` : ""}</td>
                      <td className="num py-0.5 text-right">{formatLineValue(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {c.otherYearConfirmations.length > 0 ? (
              <p className="mt-2 text-xs text-stone-600">
                Web Pay confirmations for other years, not 2025 estimates:{" "}
                {c.otherYearConfirmations.map((o, i) => (
                  <span key={i}>
                    {i > 0 ? "; " : ""}
                    <span className="num">{o.date}</span> <Amount value={o.amount} /> (tax year {o.year}) <RefInline items={o.refs} />
                  </span>
                ))}
                .
              </p>
            ) : null}
          </div>
          <div className="space-y-3">
            <div>
              <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Extension payment</h3>
              <LineTableCompact cells={c.extension} showSources showRule={false} empty="No California extension payment line." />
            </div>
            <div>
              <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Withholding</h3>
              <LineTableCompact cells={c.withholding} showSources showRule={false} empty="No California withholding line." />
            </div>
          </div>
        </div>
        <Actions j={c} revision={v.revision} canVerify={v.actor.canVerify} canRaise={v.actor.canRaise} actorRole={v.actor.role} owners={v.owners} title="California payments" />
      </Panel>

      <Panel id="penalty" title="Underpayment penalty" hint="Form 2210 and FTB 5805 lines with the method choice. The penalty is the engine's; it is not recomputed here.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Federal, Form 2210</h3>
            <LineTableCompact cells={f.penalty} showSources showRule empty="No Form 2210 lines." />
          </div>
          <div>
            <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">California, FTB 5805</h3>
            <LineTableCompact cells={c.penalty} showSources showRule empty="No FTB 5805 lines." />
          </div>
        </div>
        <div className="mt-3">
          <Statement tone="stone">
            <span className="font-medium">Method choice.</span> {v.penaltyMethod.statement}
          </Statement>
          {v.penaltyMethod.whatIf ? (
            <p className="mt-1 text-xs text-stone-500">
              What-if <span className="num">{v.penaltyMethod.whatIf.id}</span>: regular <Amount value={v.penaltyMethod.whatIf.basePenalty} />, annualized <Amount value={v.penaltyMethod.whatIf.alternativePenalty} />, change{" "}
              <Amount value={v.penaltyMethod.whatIf.penaltyChange} />.
            </p>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
