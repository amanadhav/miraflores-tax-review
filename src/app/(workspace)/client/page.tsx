import Link from "next/link";
import { ClientApprovalForm } from "@/components/client-approval";
import { ClientInbox } from "@/components/client-inbox";
import { ClientRequestThread } from "@/components/client-request-thread";
import { dateTime, money, signed } from "@/lib/format";
import { requireSessionContext } from "@/server/request";
import { clientView, type PresentedChangeView } from "@/server/queries/client";

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

function valueText(v: unknown): string {
  if (v === null || v === undefined) return "blank";
  if (typeof v === "number") return money(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

function ChangeRow({ c }: { c: PresentedChangeView }) {
  return (
    <tr className="border-t border-stone-100 align-top">
      <td className="px-5 py-2">
        <div className="text-sm">{c.lineLabel}</div>
        <div className="num text-[11px] text-stone-400">{c.line}</div>
      </td>
      <td className="px-2 py-2 text-sm">
        {c.kind === "label" ? (
          <>
            <span className="text-stone-500">{c.fromLabel ?? "blank"}</span> to <span className="font-medium">{c.toLabel ?? "blank"}</span>
          </>
        ) : c.kind === "value" ? (
          <>
            <span className="num text-stone-500">{valueText(c.from)}</span> to <span className="num font-medium">{valueText(c.to)}</span>
          </>
        ) : (
          "supporting documents added; amount unchanged"
        )}
      </td>
      <td className="px-2 py-2 text-sm">
        <p>{c.reason}</p>
        {c.evidence.length ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-stone-600">
            {c.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : null}
      </td>
      <td className="px-2 py-2 text-xs">
        <div>
          federal tax <span className="num">{signed(c.effectFederal)}</span>
        </div>
        <div>
          California tax <span className="num">{signed(c.effectCalifornia)}</span>
        </div>
        <div className="mt-1 text-stone-500">{c.effectStatus === "unknown" ? "effect not estimable" : c.effectStatus.replace(/_/g, " ")}</div>
        {c.limitations.length ? <div className="mt-1 text-stone-500">{c.limitations.join(" ")}</div> : null}
      </td>
    </tr>
  );
}

export default async function ClientPage() {
  const ctx = await requireSessionContext();
  if (ctx.actor.role !== "client") {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Client portal</h1>
        <p className="text-sm text-stone-600">
          This screen is what {ctx.packet.packet.firm.client_users.map((c) => c.name).join(" and ")} see: their own notifications, the questions addressed to them with the thread
          of replies and attachments, the presented return in plain language with the approval and simulated e-file signature, and after submission the status of each filing with a
          self-contained client copy.
        </p>
        <p className="text-sm text-stone-600">
          Clients never see findings, review notes, sign-offs, the audit history or other workspaces; the client query does not even load them. To look at it as a client, switch
          persona in the header to one of the client users.
        </p>
        <p className="text-sm">
          <Link href="/filing" className="text-blue-700 hover:underline">
            Back to Filing
          </Link>
          <span className="mx-2 text-stone-300">|</span>
          <Link href="/overview" className="text-blue-700 hover:underline">
            Overview
          </Link>
        </p>
      </div>
    );
  }

  const v = await clientView(ctx);
  const rev = v.revision;
  const p = v.presentation;
  const openRequests = v.requests.filter((r) => r.open);
  const closedRequests = v.requests.filter((r) => !r.open);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Hello, {v.viewer.name}</h1>
        <p className="mt-1 text-sm text-stone-600">
          Your {v.household.taxYear} income tax return ({v.household.filingStatus}, {v.household.taxpayer}
          {v.household.spouse ? ` and ${v.household.spouse}` : ""}). Status: <span className="font-medium text-stone-800">{v.workspace.stateLabel}</span>.
        </p>
        <p className="mt-1 text-xs text-stone-500">
          Business date <span className="num">{v.asOf.slice(0, 10)}</span>. Everything you write or attach here becomes part of your file with your name and the date. All filing
          steps in this demonstration are simulated: nothing is sent to the IRS or the FTB.
        </p>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-medium">Inbox</h2>
          <span className="text-xs text-stone-500">{v.unreadCount} unread</span>
        </div>
        <div className="mt-3">
          <ClientInbox revision={rev} items={v.inbox} />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-medium">Questions from the firm</h2>
          <span className="text-xs text-stone-500">
            {openRequests.length} open, {closedRequests.length} closed
          </span>
        </div>
        {v.requests.length === 0 ? <p className="rounded-lg border border-stone-200 bg-white p-5 text-sm text-stone-600">No questions for you right now.</p> : null}
        {openRequests.map((r) => (
          <ClientRequestThread key={r.id} revision={rev} request={r} viewerName={v.viewer.name} />
        ))}
        {closedRequests.map((r) => (
          <ClientRequestThread key={r.id} revision={rev} request={r} viewerName={v.viewer.name} />
        ))}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Your return</h2>
          {p ? (
            <p className="mt-1 text-xs text-stone-500">
              Presented {dateTime(p.presentedAt)} from engine version <span className="num">{p.version}</span>. This presentation is frozen; its identifier is{" "}
              <span className="num">{p.contentHash.slice(0, 16)}</span>. If the firm changes anything after you approve, your approval reopens and you will be asked again.
            </p>
          ) : (
            <p className="mt-1 text-xs text-stone-500">Your return has not been presented for approval yet. You will get a notification here when it is.</p>
          )}
        </div>
        {p ? (
          <div className="space-y-6 px-5 py-4">
            <div>
              <h3 className="text-sm font-medium">The numbers as the engine computed them</h3>
              <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Federal income (AGI)" value={money(p.baseline.federal.agi)} />
                <Stat label="Federal total tax" value={money(p.baseline.federal.total_tax)} />
                <Stat label="Federal already paid" value={money(p.baseline.federal.payments)} />
                <Stat label="Federal balance due" value={money(p.baseline.federal.balance_due)} hint={`includes a ${money(p.baseline.federal.penalty)} penalty estimate`} />
                <Stat label="California income (CA AGI)" value={money(p.baseline.california.ca_agi)} />
                <Stat label="California total tax" value={money(p.baseline.california.total_tax)} />
                <Stat label="California already paid" value={money(p.baseline.california.payments)} />
                <Stat label="California balance due" value={money(p.baseline.california.balance_due)} hint="a negative amount is a refund" />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium">Changes the firm made after that, and why</h3>
              {p.changes.length === 0 ? (
                <p className="mt-2 text-sm text-stone-600">None. Every amount is as the engine computed it.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="text-left text-xs text-stone-500">
                      <tr>
                        <th className="px-5 py-2 font-normal">Line</th>
                        <th className="px-2 py-2 font-normal">Change</th>
                        <th className="px-2 py-2 font-normal">Why, and what it is based on</th>
                        <th className="px-2 py-2 font-normal">Estimated effect on tax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.changes.map((c) => (
                        <ChangeRow key={c.id} c={c} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Estimated federal tax effect" value={signed(p.effects.federal)} />
                <Stat label="Estimated California tax effect" value={signed(p.effects.california)} />
                <Stat label="Federal balance due effect" value={signed(p.effects.balanceFederal)} />
                <Stat label="California balance due effect" value={signed(p.effects.balanceCalifornia)} />
              </div>
              <p className="mt-2 text-xs text-stone-500">{p.note}</p>
              {p.limitations.length ? (
                <div className="mt-2 text-xs text-stone-500">
                  Limits of these estimates:
                  <ul className="list-disc pl-5">
                    {p.limitations.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div>
              <h3 className="text-sm font-medium">Approval and e-file authorization (simulated)</h3>
              <table className="mt-2 w-full max-w-xl text-sm">
                <tbody>
                  {p.approvals.map((a) => (
                    <tr key={a.personId} className="border-t border-stone-100">
                      <td className="py-1.5">
                        {a.personName}
                        {a.mine ? <span className="ml-1 text-xs text-stone-500">(you)</span> : null}
                      </td>
                      <td className="py-1.5">
                        {a.status === "approved" ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">approved and signed (simulated)</span>
                        ) : a.status === "invalidated" ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">approval reopened</span>
                        ) : (
                          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">not yet approved</span>
                        )}
                      </td>
                      <td className="num py-1.5 text-xs text-stone-500">{a.signedAt ? dateTime(a.signedAt) : ""}</td>
                      <td className="py-1.5 text-xs text-stone-500">{a.invalidationReason ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3">
                <ClientApprovalForm revision={rev} snapshotId={p.snapshotId} canApprove={p.canApprove} blockedReason={p.approveBlockedReason} />
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {v.filings.length ? (
        <section className="rounded-lg border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-5 py-3">
            <h2 className="font-medium">Filing status (simulated)</h2>
            <p className="mt-1 text-xs text-stone-500">Each attempt is kept; a rejected attempt is followed by a corrected one. Nothing here was transmitted to a real agency.</p>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-5 py-2 font-normal">Return</th>
                <th className="px-2 py-2 font-normal">Attempt</th>
                <th className="px-2 py-2 font-normal">Status</th>
                <th className="px-2 py-2 font-normal">Submitted</th>
                <th className="px-2 py-2 font-normal">Response</th>
                <th className="px-2 py-2 font-normal">Agency message</th>
              </tr>
            </thead>
            <tbody>
              {v.filings.map((f) => (
                <tr key={`${f.jurisdiction}-${f.attempt}`} className="border-t border-stone-100 align-top">
                  <td className="px-5 py-2">{f.jurisdictionLabel}</td>
                  <td className="num px-2 py-2">{f.attempt}</td>
                  <td className="px-2 py-2">{f.statusLabel}</td>
                  <td className="num px-2 py-2 text-xs">{dateTime(f.submittedAt)}</td>
                  <td className="num px-2 py-2 text-xs">{f.decidedAt ? dateTime(f.decidedAt) : ""}</td>
                  <td className="px-2 py-2 text-xs text-stone-600">
                    {f.errors.map((e) => (
                      <div key={e.code}>
                        <span className="num">{e.code}</span>: {e.message}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {v.clientCopy ? (
        <section className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="font-medium">Your copy</h2>
          <p className="mt-1 text-sm text-stone-600">
            A self-contained copy of the {v.clientCopy.kind === "accepted" ? "accepted" : v.clientCopy.kind === "submission" ? "submitted" : "presented"} return: every line, the changes
            and their reasons, the approvals and the filing status. It opens without this app and shows Social Security numbers as the last four digits only.
          </p>
          <p className="mt-2 text-sm">
            <a href={v.clientCopy.htmlHref} className="text-blue-700 hover:underline">
              Download the client copy (HTML)
            </a>
            <span className="mx-2 text-stone-300">|</span>
            <a href={v.clientCopy.jsonHref} className="text-blue-700 hover:underline">
              JSON
            </a>
          </p>
        </section>
      ) : null}
    </div>
  );
}
