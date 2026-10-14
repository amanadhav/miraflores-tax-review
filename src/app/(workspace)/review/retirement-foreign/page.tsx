import Link from "next/link";
import { RaiseFindingForm } from "@/components/finding-forms";
import { RefLink } from "@/components/ref-link";
import { ClientItemCard, DocCard, DocList, Fact, Facts, JudgmentList, LineAmount, LineName, LineRows, Note, Panel, ParamChips, RecordHeader, RefChips, SubHeading, TrailTable, ValueRows } from "@/components/recordsb-shell";
import { money } from "@/lib/format";
import { retirementForeignView } from "@/server/queries/records-b";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

/**
 * Form 8606, the HSA, the SEP and self-employed health insurance, and the
 * Swedish account on Schedule B and Form 8938 with the exchange rate choice
 * written down rather than applied.
 */
export default async function RetirementForeignPage() {
  const ctx = await requireSessionContext();
  const v = await retirementForeignView(ctx);
  const f = v.foreign;

  return (
    <div className="space-y-6">
      <RecordHeader
        title="Retirement and foreign items"
        lead="The backdoor Roth on Form 8606, the HSA on Form 8889, the SEP and health insurance adjustments, and the Swedish savings account on Schedule B and Form 8938."
        header={v}
        current="/review/retirement-foreign"
      />

      <Panel id="ira" title="Nondeductible IRA and Roth conversion (Form 8606)" hint="Prior basis is carried from the 2024 Form 8606; the Form 1099-R and both Forms 5498 are the sources.">
        <LineRows lines={v.ira.lines} />
        <div className="mt-3">
          <Note tone="amber" title="Questionnaire conflict on prior basis, handled by the records">
            <p>{v.ira.conflict}</p>
            <div className="mt-1">
              <RefChips refs={v.ira.priorBasis.refs} />
            </div>
          </Note>
        </div>
        {v.ira.questionnaire ? (
          <div className="mt-2">
            <ClientItemCard item={v.ira.questionnaire} />
          </div>
        ) : null}
        <SubHeading>Documents</SubHeading>
        <DocList docs={v.ira.docs} />
      </Panel>

      <Panel id="hsa" title="Health savings account (Form 8889)" hint="Employer contributions are the W-2 box 12 code W amounts; distributions come from Form 1099-SA; the family limit is an engine parameter.">
        <ParamChips params={[v.hsa.limit]} />
        <div className="mt-3">
          <LineRows lines={v.hsa.lines} />
        </div>
        <SubHeading>W-2 code W values</SubHeading>
        <ValueRows values={v.hsa.codeW} empty="No W-2 code W values in the packet." />
        <SubHeading>Documents</SubHeading>
        <DocList docs={v.hsa.docs} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="sep" title="SEP contribution (Schedule 1, line 16)" hint="The deposit confirmation shows what went in; the engine limited the deduction and carried the rest out as not deductible for 2025.">
          {v.sep.line ? (
            <Facts>
              <Fact label="Deduction on the return">
                <span>
                  <LineName line={v.sep.line} /> <LineAmount line={v.sep.line} />
                </span>
              </Fact>
              <Fact label="Engine note">
                <span className="text-xs text-stone-700">{v.sep.note ?? "none"}</span>
              </Fact>
              <Fact label="Deposited per confirmation">
                <span className="num font-medium">{v.sep.deposited === null ? "unknown" : money(v.sep.deposited)}</span>
              </Fact>
              <Fact label="Not deductible for 2025">
                <span className="num font-medium">{v.sep.notDeductible.amount === null ? "not supplied" : money(v.sep.notDeductible.amount)}</span>
                <span className="ml-2 text-xs text-stone-500">{v.sep.notDeductible.label}</span>
              </Fact>
            </Facts>
          ) : (
            <p className="text-xs text-stone-500">No SEP line in this version.</p>
          )}
          <div className="mt-3">
            <Note tone="amber" title="Open item" actions={v.sep.line ? [{ label: `Open ${v.sep.line.key}`, href: v.sep.line.href }] : []}>
              {v.sep.openItem}
            </Note>
          </div>
          <SubHeading>Deposit confirmation</SubHeading>
          <ValueRows values={v.sep.deposit} />
          {v.sep.doc ? (
            <div className="mt-2">
              <DocCard doc={v.sep.doc} values={false} />
            </div>
          ) : null}
          {v.sep.questionnaire ? (
            <div className="mt-2">
              <ClientItemCard item={v.sep.questionnaire} />
            </div>
          ) : null}
        </Panel>

        <Panel id="sehi" title="Self-employed health insurance (Schedule 1, line 17)" hint="The premium statement is the source. Eligibility for employer coverage is a judgment, not an automatic disallowance.">
          {v.sehi.line ? (
            <p className="text-sm">
              <LineName line={v.sehi.line} /> <LineAmount line={v.sehi.line} />
            </p>
          ) : (
            <p className="text-xs text-stone-500">No self-employed health insurance line in this version.</p>
          )}
          <div className="mt-3">
            <Note tone="amber" title="Judgment item: eligibility for employer coverage" actions={v.sehi.line ? [{ label: `Propose on ${v.sehi.line.key}`, href: `${v.sehi.line.href}#propose` }] : []}>
              <p>{v.sehi.judgmentItem}</p>
              {v.sehi.priorYearNote ? <p className="mt-1">2024 return note: {v.sehi.priorYearNote}</p> : null}
            </Note>
          </div>
          {v.sehi.questionnaire ? (
            <div className="mt-2">
              <ClientItemCard item={v.sehi.questionnaire} />
            </div>
          ) : null}
          <div className="mt-2">
            <JudgmentList items={v.sehi.judgments} href={v.sehi.judgmentHref} subject={v.sehi.line?.key ?? "Sch1.17"} />
          </div>
          <SubHeading>Premium statement</SubHeading>
          <ValueRows values={v.sehi.premiums} />
          {v.sehi.doc ? (
            <div className="mt-2">
              <DocCard doc={v.sehi.doc} values={false} />
            </div>
          ) : null}
        </Panel>
      </div>

      <Panel id="foreign-interest" title="Foreign interest on Schedule B" hint="The Swedish interest is converted by the engine at the rate named in the line's sources. The other supplied rates are shown with what the line would read, as a choice to document.">
        {f.interest ? (
          <div className="space-y-3">
            <p className="text-sm">
              <LineName line={f.interest} /> <LineAmount line={f.interest} />
            </p>
            <Facts>
              <Fact label="Amount in SEK">
                {f.sek ? (
                  <span>
                    <Link href={f.sek.href} className="num text-blue-700 hover:underline">
                      {f.sek.display}
                    </Link>{" "}
                    <span className="num text-xs text-stone-400">{f.sek.id}</span>
                  </span>
                ) : (
                  <span className="text-xs text-stone-400">unknown</span>
                )}
              </Fact>
              <Fact label="Rate the engine used">
                {f.rateUsed ? (
                  <span>
                    <span className="num font-medium">{f.rateUsed.value}</span> {f.rateUsed.label} <RefLink refId={f.rateUsed.ref} label={f.rateUsed.ref} />
                  </span>
                ) : (
                  <span className="text-xs text-stone-400">no rate reference among the sources</span>
                )}
              </Fact>
            </Facts>
            <table className="w-full text-xs">
              <thead className="text-left text-stone-500">
                <tr>
                  <th className="py-0.5 pr-2 font-normal">Supplied rate</th>
                  <th className="py-0.5 pr-2 text-right font-normal">SEK per USD</th>
                  <th className="py-0.5 pr-2 text-right font-normal">Line would read (computed here)</th>
                  <th className="py-0.5 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {f.alternatives.map((a) => (
                  <tr key={a.rate} className={`border-t border-stone-100 ${a.used ? "bg-stone-50 font-medium" : ""}`}>
                    <td className="py-0.5 pr-2">
                      {a.label} <RefLink refId={a.ref} label={a.ref} />
                    </td>
                    <td className="num py-0.5 pr-2 text-right">{a.value ?? "n/a"}</td>
                    <td className="num py-0.5 pr-2 text-right">{a.usd === null ? "n/a" : money(a.usd)}</td>
                    <td className="py-0.5">{a.used ? <span className="rounded bg-stone-200 px-1.5 py-0.5">used by the engine</span> : <span className="text-stone-500">not applied</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Note tone="blue" title="Identified rate choice to document" actions={[{ label: `Propose on ${f.interest.key}`, href: `${f.interest.href}#propose` }, { label: `Verify on ${f.interest.key}`, href: `${f.interest.href}#evidence` }]}>
              {f.rateNote}
            </Note>
          </div>
        ) : (
          <p className="text-xs text-stone-500">No foreign interest line in this version.</p>
        )}
        <SubHeading>Foreign account questions</SubHeading>
        <LineRows lines={f.account} notes={false} />
      </Panel>

      <Panel id="f8938" title="Specified foreign financial assets (Form 8938)" hint="Values at the year-end Treasury rate the engine names; the maximum value during the year comes from the statement.">
        <LineRows lines={f.f8938} />
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <Facts>
            <Fact label="Year-end rate used">
              {f.yearEndRate ? (
                <span>
                  <span className="num font-medium">{f.yearEndRate.value}</span> <RefLink refId={f.yearEndRate.ref} label={f.yearEndRate.ref} />
                </span>
              ) : (
                <span className="text-xs text-stone-400">not referenced</span>
              )}
            </Fact>
            <Fact label="Highest balance (SEK)">
              {f.maxValue ? (
                <Link href={f.maxValue.href} className="num text-blue-700 hover:underline">
                  {f.maxValue.display}
                </Link>
              ) : (
                <span className="text-xs text-stone-400">unknown</span>
              )}
            </Fact>
            <Fact label="Year-end balance (SEK)">
              {f.yeValue ? (
                <Link href={f.yeValue.href} className="num text-blue-700 hover:underline">
                  {f.yeValue.display}
                </Link>
              ) : (
                <span className="text-xs text-stone-400">unknown</span>
              )}
            </Fact>
          </Facts>
          <div className="lg:col-span-2">
            <Note tone="amber" title="FBAR is outside this return and this engagement">
              <p>
                {f.fbar.deadline ? (
                  <>
                    Firm deadline: {f.fbar.deadline.what}, <span className="num font-medium">{f.fbar.deadline.date}</span>.{" "}
                  </>
                ) : (
                  "No FinCEN 114 deadline is listed in the firm settings. "
                )}
                {f.fbar.priorNote ? `Prior preparer note: ${f.fbar.priorNote}` : ""}
              </p>
              <div className="mt-2">
                <TrailTable trail={f.fbar.diagnostic} />
              </div>
            </Note>
          </div>
        </div>
        <SubHeading>Source statement</SubHeading>
        {f.doc ? <DocCard doc={f.doc} pages /> : <p className="text-xs text-stone-500">No foreign bank statement in the packet.</p>}
        <p className="mt-1 text-xs text-stone-500">The account number is masked server-side; a cleared reviewer reveals it one value at a time through the logged reveal command.</p>
      </Panel>

      <Panel id="raise" title="Raise a finding" hint="Findings raised here land in the deductions and credits area; name the line or document in the refs so the right area owner sees it.">
        <RaiseFindingForm areaId={v.area.id} areaLabel={v.area.label} revision={v.revision} canRaise={v.actor.canRaise} actorRole={v.actor.role} owners={v.owners} />
      </Panel>
    </div>
  );
}
