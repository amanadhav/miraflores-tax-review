import { SensitiveValue } from "@/components/sensitive-value";
import { dateTime } from "@/lib/format";
import { loadFirm, type FirmView } from "@/server/queries/firm";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

/**
 * The firm: who is on the engagement, the standards in force, budgets, and
 * the identity numbers the firm and the household file under. Numbers are
 * masked; a cleared person reveals one at a time and every view is logged.
 */
export default async function FirmPage() {
  const ctx = await requireSessionContext();
  if (ctx.actor.role === "client") {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Firm</h1>
        <p className="text-sm text-stone-600">This screen is for firm staff. Your requests and approvals are on the client page.</p>
      </div>
    );
  }
  const firm = await loadFirm(ctx);
  const clock = firm.status.asOf.slice(0, 10);
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">{firm.name}</h1>
        <p className="mt-1 text-sm text-stone-600">
          Engagement status: <span className="font-medium">{firm.status.workflowState.replace(/_/g, " ")}</span>
          {firm.status.filingLocked ? " (frozen for filing)" : ""}, return {firm.status.activeVersion}, clock {clock}, revision {firm.status.revision}.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card title="Engagement">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {firm.assignments.map((a) => (
              <Row key={a.level} label={a.level}>
                {a.name}
              </Row>
            ))}
          </dl>
          <p className="mt-3 text-xs text-stone-500">Assignments come from the packet and are managed by the partner or firm administrator.</p>
        </Card>
        <Card title="Deadlines">
          <table className="w-full text-sm">
            <tbody>
              {firm.deadlines.map((d) => (
                <tr key={`${d.what}-${d.date}`} className="border-t border-stone-100 first:border-t-0">
                  <td className="py-1 pr-3">{d.what}</td>
                  <td className="num py-1 pr-3 whitespace-nowrap">{d.date}</td>
                  <td className="py-1 text-xs whitespace-nowrap text-stone-500">{relative(d.daysFromClock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-stone-500">Relative to the replay clock, {clock}.</p>
        </Card>
      </section>

      <Card title="Staff">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="py-1 pr-3 font-normal">Person</th>
              <th className="py-1 pr-3 font-normal">Role</th>
              <th className="py-1 pr-3 font-normal">Credential</th>
              <th className="py-1 pr-3 font-normal">Sensitive clearance</th>
              <th className="py-1 pr-3 font-normal">Active from</th>
              <th className="py-1 pr-3 font-normal">At {clock}</th>
              <th className="py-1 font-normal">On this engagement</th>
            </tr>
          </thead>
          <tbody>
            {firm.staff.map((s) => (
              <tr key={s.id} className="border-t border-stone-100 align-top">
                <td className="py-1 pr-3">
                  {s.name}
                  {s.note ? <div className="text-xs text-stone-500">{s.note}</div> : null}
                </td>
                <td className="py-1 pr-3">{s.role}</td>
                <td className="py-1 pr-3">{s.credential ?? "none"}</td>
                <td className="py-1 pr-3">{s.clearance ? "cleared" : <span className="text-amber-800">not cleared</span>}</td>
                <td className="num py-1 pr-3">{s.activeFrom}</td>
                <td className="py-1 pr-3">{s.available ? "available" : <span className="text-stone-500">not yet active</span>}</td>
                <td className="py-1">{s.assignments.length ? s.assignments.join(", ") : <span className="text-stone-400">none</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card title="Firm identity">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <Row label="EIN">
              <span className="num">{firm.identity.ein}</span>
            </Row>
            <Row label="Address">{firm.identity.address}</Row>
            <Row label="Phone">
              <span className="num">{firm.identity.phone}</span>
            </Row>
            <Row label="EFIN">
              <SensitiveValue refId="firm:identity" field="efin" masked={firm.identity.efinMasked} label="EFIN" />
            </Row>
            <Row label="ERO PIN">
              <SensitiveValue refId="firm:identity" field="ero_pin" masked={firm.identity.eroPinMasked} label="ERO PIN" />
            </Row>
            {firm.identity.ptins.map((p) => (
              <Row key={p.staffId} label={`PTIN, ${p.name}`}>
                <SensitiveValue refId="firm:identity" field={`ptin:${p.staffId}`} masked={p.masked} label={`PTIN of ${p.name}`} />
              </Row>
            ))}
            <Row label="Signs returns">{firm.identity.signer}</Row>
          </dl>
          <p className="mt-3 text-xs text-stone-500">Masked by default. Reveal shows one value for 30 seconds and writes a view event.</p>
        </Card>

        {firm.household ? (
          <Card title="Household identity">
            <p className="mb-2 text-xs text-stone-500">
              {firm.household.filingStatus}, tax year {firm.household.taxYear}. Identity verification happens here; every unmasked view is logged.
            </p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="py-1 pr-3 font-normal">Person</th>
                  <th className="py-1 pr-3 font-normal">Born</th>
                  <th className="py-1 pr-3 font-normal">SSN</th>
                  <th className="py-1 font-normal">IP PIN</th>
                </tr>
              </thead>
              <tbody>
                {firm.household.people.map((p) => (
                  <tr key={p.id} className="border-t border-stone-100 align-top">
                    <td className="py-1 pr-3">
                      {p.name}
                      <div className="text-xs text-stone-500">{p.relationship ? `${p.role}, ${p.relationship}` : p.role}</div>
                    </td>
                    <td className="num py-1 pr-3">{p.dob}</td>
                    <td className="py-1 pr-3">
                      <SensitiveValue refId={`household:${p.id}`} field="ssn" masked={p.ssnMasked} label={`SSN of ${p.name}`} />
                    </td>
                    <td className="py-1">
                      {p.ipPinMasked ? (
                        <SensitiveValue refId={`household:${p.id}`} field="ip_pin" masked={p.ipPinMasked} label={`IP PIN of ${p.name}`} />
                      ) : (
                        <span className="text-xs text-stone-400">none on file</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-stone-100 pt-3 text-sm">
              <Row label="Bank">
                {firm.household.bank.bank}, {firm.household.bank.type}
              </Row>
              <Row label="Routing">
                <SensitiveValue refId="household:bank" field="routing" masked={firm.household.bank.routingMasked} label="bank routing number" />
              </Row>
              <Row label="Account">
                <SensitiveValue refId="household:bank" field="account" masked={firm.household.bank.accountMasked} label="bank account number" />
              </Row>
            </dl>
          </Card>
        ) : null}
      </section>

      <Card title={`Standards in force (${firm.standards.version})`}>
        <p className="text-xs text-stone-500">{firm.standards.note} Editing standards is not yet implemented; these are applied as supplied.</p>
        <div className="mt-3 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium text-stone-500">Rules</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {firm.standards.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-medium text-stone-500">Required steps</h3>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
              {firm.standards.requiredSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-stone-100 pt-3 text-sm">
          <Row label="Verification types">{firm.standards.verificationTypes.map((v) => v.replace(/_/g, " ")).join(", ")}</Row>
          <Row label="Review levels">{firm.standards.reviewLevels.join(", ")}</Row>
          <Row label="Variance review">
            Flag a line that moved more than {firm.standards.variance.percent}% and more than {firm.standards.variance.amount.toLocaleString("en-US")} against the{" "}
            {firm.standards.variance.compareTo.replace(/_/g, " ")}.
          </Row>
        </dl>
      </Card>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card title="Budget hours by area">
          <table className="w-full text-sm">
            <tbody>
              {firm.budget.rows.map((r) => (
                <tr key={r.areaId} className="border-t border-stone-100 first:border-t-0">
                  <td className="py-1 pr-6">{r.label}</td>
                  <td className="num py-1 text-right">{r.hours} h</td>
                  <td className="py-1 pl-4 text-right text-xs text-stone-400">no time logged</td>
                </tr>
              ))}
              <tr className="border-t border-stone-200 font-medium">
                <td className="py-1 pr-6">Total</td>
                <td className="num py-1 text-right">{firm.budget.total} h</td>
                <td />
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-stone-500">Time entries against these budgets are not yet implemented, so no hours are shown as used.</p>
        </Card>

        <Card title="Sensitive-data view log">
          <ViewLog log={firm.viewLog} />
        </Card>
      </section>
    </div>
  );
}

function ViewLog({ log }: { log: FirmView["viewLog"] }) {
  if (log === null) {
    return <p className="text-sm text-stone-600">View log restricted. It is available to cleared staff and the firm administrator.</p>;
  }
  if (log.length === 0) return <p className="text-sm text-stone-600">No sensitive values have been requested in this workspace.</p>;
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="py-1 pr-3 font-normal">When</th>
            <th className="py-1 pr-3 font-normal">Person</th>
            <th className="py-1 pr-3 font-normal">Target</th>
            <th className="py-1 pr-3 font-normal">Outcome</th>
            <th className="py-1 font-normal">Reason</th>
          </tr>
        </thead>
        <tbody>
          {log.map((e) => (
            <tr key={e.id} className="border-t border-stone-100 align-top">
              <td className="num py-1 pr-3 whitespace-nowrap text-xs">{dateTime(e.at)}</td>
              <td className="py-1 pr-3">{e.actorName}</td>
              <td className="num py-1 pr-3 text-xs">
                {e.ref} {e.field}
              </td>
              <td className="py-1 pr-3">
                {e.outcome === "revealed" ? (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">revealed</span>
                ) : (
                  <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">denied</span>
                )}
              </td>
              <td className="py-1 text-xs text-stone-600">{e.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="font-medium">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-stone-500">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function relative(days: number): string {
  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${-days} day${days === -1 ? "" : "s"} ago`;
}
