import { RaiseFindingForm } from "@/components/finding-forms";
import { ClientItems, DocList, FindingChip, JudgmentList, LineAmount, LineName, LineRows, Note, Panel, ParamChips, RecordHeader, RefChips, SubHeading, TrailTable, ValueRows } from "@/components/recordsb-shell";
import { deductionsCreditsView, type Callout } from "@/server/queries/records-b";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function CalloutBox({ c, tone = "amber" }: { c: Callout; tone?: "amber" | "red" | "blue" }) {
  return (
    <Note tone={tone} title={c.title} actions={c.actions}>
      <p>{c.detail}</p>
      {c.evidence.length > 0 ? (
        <div className="mt-1 rounded bg-white/70 p-1">
          <ValueRows values={c.evidence} />
        </div>
      ) : null}
      <div className="mt-1">
        <RefChips refs={c.refs} />
      </div>
    </Note>
  );
}

/**
 * Schedule A with the SALT computation, mortgage interest and property tax
 * with their closing and payoff statements, charitable gifts, education,
 * dependent care, the child tax credit and the Form 8867 due diligence status.
 * Thresholds and limits from the engine reference sit next to the lines they
 * govern.
 */
export default async function DeductionsCreditsPage() {
  const ctx = await requireSessionContext();
  const v = await deductionsCreditsView(ctx);

  return (
    <div className="space-y-6">
      <RecordHeader
        title="Deductions and credits"
        lead="Schedule A, the noncash gift forms, education and dependent care credits, the child tax credit and the preparer's due diligence status, each with its documents and the engine thresholds that govern it."
        header={v}
        current="/review/deductions-credits"
      />

      <Panel id="salt" title="State and local taxes (Schedule A, lines 5 to 7)" hint="The engine rules and the cap parameters that govern these lines.">
        <ParamChips params={v.salt.params} />
        <ul className="mt-2 space-y-0.5 text-xs text-stone-700">
          {v.salt.rules.map((r) => (
            <li key={r.id}>
              <span className="num font-medium">{r.id}</span>: {r.text}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-stone-700">
          {v.salt.capApplies}
          {v.salt.agi ? (
            <>
              {" "}
              (<LineName line={v.salt.agi} /> <LineAmount line={v.salt.agi} />)
            </>
          ) : null}
        </p>
        <div className="mt-3">
          <LineRows lines={v.salt.lines} />
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="property-tax" title="Real estate taxes on the home" hint="Sourced from the escrow disbursement on the refinance 1098 and the county receipt.">
          {v.propertyTax.line ? (
            <p className="text-sm">
              <LineName line={v.propertyTax.line} note /> <LineAmount line={v.propertyTax.line} />
            </p>
          ) : (
            <p className="text-xs text-stone-500">No real estate tax line in this version.</p>
          )}
          {v.propertyTax.sellerCredit ? (
            <div className="mt-3">
              <CalloutBox c={v.propertyTax.sellerCredit} />
            </div>
          ) : null}
          <SubHeading>Documents</SubHeading>
          <DocList docs={v.propertyTax.docs} />
        </Panel>

        <Panel id="mortgage" title="Home mortgage interest (Schedule A, lines 8 to 10)" hint="Each Form 1098 and the payoff statement, with where each value landed.">
          <LineRows lines={v.mortgage.lines} />
          {v.mortgage.payoff ? (
            <div className="mt-3">
              <CalloutBox c={v.mortgage.payoff} tone="red" />
            </div>
          ) : null}
          {v.mortgage.rentalInterest ? (
            <p className="mt-2 text-xs text-stone-600">
              The condo loan 1098 feeds the rental, not Schedule A: <LineName line={v.mortgage.rentalInterest} /> <LineAmount line={v.mortgage.rentalInterest} />.
            </p>
          ) : null}
          <SubHeading>Forms 1098 and the payoff statement</SubHeading>
          <DocList docs={v.mortgage.docs} />
        </Panel>
      </div>

      <Panel id="charitable" title="Gifts to charity (Schedule A, lines 11 to 14; Form 8283)" hint="Cash gifts with their receipts; noncash gifts with the stock acknowledgment and the Form 1098-C.">
        <SubHeading>Cash gifts</SubHeading>
        {v.charitable.cash.line ? (
          <p className="text-sm">
            <LineName line={v.charitable.cash.line} /> <LineAmount line={v.charitable.cash.line} />
          </p>
        ) : null}
        {v.charitable.cash.lowConfidence ? (
          <div className="mt-2">
            <CalloutBox c={v.charitable.cash.lowConfidence} />
          </div>
        ) : null}
        <div className="mt-2">
          <p className="text-xs text-stone-500">Client corroboration at the replay clock:</p>
          <ClientItems items={v.charitable.cash.corroboration} empty="No client message corroborates the handwritten receipt in the packet." />
        </div>
        <div className="mt-2">
          <DocList docs={v.charitable.cash.docs} />
        </div>

        <SubHeading>Noncash gifts (Form 8283)</SubHeading>
        <LineRows lines={v.charitable.noncash.lines} />
        {v.charitable.noncash.total ? (
          <p className="mt-1 text-xs">
            <LineName line={v.charitable.noncash.total} /> <LineAmount line={v.charitable.noncash.total} />
          </p>
        ) : null}
        {v.charitable.noncash.vehicle ? (
          <div className="mt-2">
            <CalloutBox c={v.charitable.noncash.vehicle} />
          </div>
        ) : null}
        <div className="mt-2">
          <DocList docs={v.charitable.noncash.docs} />
        </div>
        <SubHeading>Totals</SubHeading>
        <LineRows lines={v.charitable.totals} notes={false} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="education" title="Education credit (Form 8863)" hint="The phase-out range is an engine parameter; the diagnostic records that the credit phased out.">
          <ParamChips params={v.education.params} />
          {v.education.agi ? (
            <p className="mt-1 text-xs text-stone-600">
              Modified AGI: <LineName line={v.education.agi} /> <LineAmount line={v.education.agi} />
            </p>
          ) : null}
          <div className="mt-3">
            <LineRows lines={v.education.lines} />
          </div>
          <SubHeading>Engine diagnostic</SubHeading>
          <TrailTable trail={v.education.diagnostic} />
          <SubHeading>Documents</SubHeading>
          <DocList docs={v.education.docs} />
        </Panel>

        <Panel id="dependent-care" title="Child and dependent care (Form 2441)" hint="Provider statements against what the return carries for each provider.">
          <ParamChips params={v.dependentCare.params} />
          <div className="mt-3">
            <LineRows lines={v.dependentCare.lines} />
          </div>
          {v.dependentCare.callouts.length > 0 ? (
            <div className="mt-3 space-y-2">
              {v.dependentCare.callouts.map((c) => (
                <CalloutBox key={c.id} c={c} tone="red" />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-stone-500">Provider names and tax IDs on the return match the statements.</p>
          )}
          <SubHeading>Documents</SubHeading>
          <DocList docs={v.dependentCare.docs} />
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="ctc" title="Child tax credit and credit for other dependents (Form 8812)" hint="Per-child and per-dependent amounts and the phase-out start are engine parameters.">
          <ParamChips params={v.childTaxCredit.params} />
          <div className="mt-3">
            <LineRows lines={v.childTaxCredit.lines} />
          </div>
        </Panel>

        <Panel id="due-diligence" title="Paid preparer due diligence (Form 8867)" hint="The engine flags the checklist as required when the child tax credit is claimed. Completing it is recorded as a due diligence judgment.">
          {v.dueDiligence.line ? (
            <p className="text-sm">
              <LineName line={v.dueDiligence.line} /> <LineAmount line={v.dueDiligence.line} />
            </p>
          ) : (
            <p className="text-xs text-stone-500">No Form 8867 status line in this version.</p>
          )}
          {v.dueDiligence.finding ? (
            <div className="mt-2">
              <FindingChip finding={v.dueDiligence.finding} />
            </div>
          ) : null}
          <div className="mt-2">
            <TrailTable trail={v.dueDiligence.trail} />
          </div>
          <div className="mt-3">
            <JudgmentList items={v.dueDiligence.judgments} href={v.dueDiligence.href} subject={v.dueDiligence.line?.key ?? "F8867.status"} />
          </div>
        </Panel>
      </div>

      {v.itemizedTotal ? (
        <Panel id="itemized" title="Total itemized deductions">
          <p className="text-sm">
            <LineName line={v.itemizedTotal} /> <LineAmount line={v.itemizedTotal} />
          </p>
        </Panel>
      ) : null}

      <Panel id="raise" title="Raise a finding" hint="Findings raised here land in the deductions and credits area with the refs you list.">
        <RaiseFindingForm areaId={v.area.id} areaLabel={v.area.label} revision={v.revision} canRaise={v.actor.canRaise} actorRole={v.actor.role} owners={v.owners} />
      </Panel>
    </div>
  );
}
