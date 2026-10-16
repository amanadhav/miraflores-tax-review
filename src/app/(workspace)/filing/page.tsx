import Link from "next/link";
import { redirect } from "next/navigation";
import { AmendForm, NextYearForm, OutcomeForm, PresentForm, SubmitPanel } from "@/components/filing-actions";
import { CommandButton } from "@/components/command-client";
import { RefLink } from "@/components/ref-link";
import { dateOnly, dateTime, money } from "@/lib/format";
import { requireSessionContext } from "@/server/request";
import { filingView, type ReadinessItemView, type SubmissionView } from "@/server/queries/filing";

export const dynamic = "force-dynamic";

const STATE_TONE: Record<string, string> = {
  preparing: "border-stone-300 bg-stone-50 text-stone-800",
  ready_for_client: "border-blue-200 bg-blue-50 text-blue-900",
  authorized: "border-blue-300 bg-blue-50 text-blue-900",
  submitted: "border-amber-300 bg-amber-50 text-amber-900",
  rejected: "border-red-200 bg-red-50 text-red-900",
  accepted: "border-emerald-300 bg-emerald-50 text-emerald-900",
  amending: "border-violet-200 bg-violet-50 text-violet-900",
};

function StatusBadge({ status, simulated }: { status: string; simulated?: boolean }) {
  const tone =
    status === "accepted" || status === "approved" || status === "active"
      ? "bg-emerald-100 text-emerald-800"
      : status === "rejected" || status === "invalidated"
        ? "bg-red-50 text-red-700"
        : status === "submitted"
          ? "bg-amber-100 text-amber-800"
          : "bg-stone-100 text-stone-600";
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${tone}`}>
      {status.replace(/_/g, " ")}
      {simulated ? " (simulated)" : ""}
    </span>
  );
}

function Ok({ ok }: { ok: boolean }) {
  return ok ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">ok</span> : <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">not ok</span>;
}

function ReadinessRow({ item }: { item: ReadinessItemView }) {
  return (
    <tr className="border-t border-stone-100 align-top">
      <td className="px-5 py-2">
        <div className="font-medium">{item.step}</div>
      </td>
      <td className="px-2 py-2">
        <Ok ok={item.ok} />
      </td>
      <td className="px-2 py-2 text-xs">{item.blocking ? <span className="text-stone-700">blocking</span> : <span className="text-stone-500">informational</span>}</td>
      <td className="px-2 py-2 text-sm text-stone-700">{item.detail}</td>
      <td className="px-2 py-2">
        {item.refs.length === 0 ? (
          <span className="text-xs text-stone-400">none</span>
        ) : (
          <ul className="max-h-64 space-y-0.5 overflow-y-auto">
            {item.refs.map((r) => (
              <li key={r.ref} className="text-xs">
                <RefLink refId={r.ref} label={r.ref} />
                <span className={`ml-1 ${r.found ? "text-stone-500" : "text-red-600"}`}>{r.label}</span>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

function SubmissionRow({ s }: { s: SubmissionView }) {
  return (
    <tr className="border-t border-stone-100 align-top">
      <td className="num px-5 py-2">{s.attempt}</td>
      <td className="px-2 py-2">{s.jurisdiction}</td>
      <td className="px-2 py-2">
        <StatusBadge status={s.status} simulated={s.simulated} />
      </td>
      <td className="num px-2 py-2 text-xs">{s.submissionRef}</td>
      <td className="px-2 py-2 text-xs">
        {s.errors.length === 0 ? <span className="text-stone-400">none</span> : s.errors.map((e) => (
          <div key={e.code}>
            <span className="num">{e.code}</span>: {e.message}
          </div>
        ))}
      </td>
      <td className="num px-2 py-2 text-xs">{dateTime(s.submittedAt)}</td>
      <td className="num px-2 py-2 text-xs">{s.decidedAt ? dateTime(s.decidedAt) : ""}</td>
      <td className="num px-2 py-2 text-xs" title={s.snapshotHash ?? ""}>
        {s.snapshotHash ? s.snapshotHash.slice(0, 12) : s.snapshotId}
      </td>
    </tr>
  );
}

export default async function FilingPage() {
  const ctx = await requireSessionContext();
  if (ctx.actor.role === "client") redirect("/client");
  const v = await filingView(ctx);
  const rev = v.revision;
  const awaiting = v.submissions.filter((s) => s.awaitingOutcome);
  const anyAction = v.actions.present.available || v.actions.submit.available || v.actions.outcome.available || v.actions.amend.available || v.actions.nextYear.available;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Filing</h1>
        <p className="mt-1 text-sm text-stone-600">
          The lifecycle from the firm&apos;s required steps to a frozen, accepted return. Workspace <span className="num">{v.workspace.id}</span>, baseline{" "}
          <span className="num">{v.workspace.activeVersion}</span>, revision <span className="num">{rev}</span>, clock <span className="num">{dateOnly(v.asOf)}</span>. Every
          agency step here is simulated; nothing is transmitted anywhere.
        </p>
      </section>

      <section className={`rounded-lg border p-5 ${STATE_TONE[v.banner.state] ?? STATE_TONE.preparing}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-medium">{v.banner.label}</h2>
          <span className="text-xs">
            {v.banner.frozen ? <span className="rounded bg-white/70 px-2 py-0.5 font-medium">workpaper frozen</span> : <span className="rounded bg-white/70 px-2 py-0.5">workpaper open</span>}
          </span>
        </div>
        <p className="mt-2 text-sm">{v.banner.whatNext}</p>
        <p className="mt-1 text-xs opacity-80">{v.banner.frozenNote}</p>
        {v.workspace.parentWorkspaceId ? (
          <p className="mt-2 text-xs">
            Branched from workspace <span className="num">{v.workspace.parentWorkspaceId}</span>, amending snapshot <span className="num">{v.workspace.amendsSnapshotId}</span>.
          </p>
        ) : null}
        {v.amendments.length ? (
          <p className="mt-2 text-xs">
            Amendment workspaces branched from here:{" "}
            {v.amendments.map((a) => (
              <span key={a.id} className="mr-2">
                <span className="num font-medium">{a.id}</span> ({a.workflowState.replace(/_/g, " ")}, created {dateOnly(a.createdAt)})
              </span>
            ))}
            . Join one from the landing page&apos;s Join form with its id.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Required steps before filing</h2>
          <p className="mt-1 text-xs text-stone-500">
            The firm&apos;s required steps (standard <span className="num">{v.readiness.standardsVersion}</span>) evaluated from records in the workpaper: verifications, dispositions,
            judgments, findings, proposals and sign-offs. Nothing here is a checkbox a page can tick; the server re-evaluates the same list inside the present and submit commands.{" "}
            {v.readiness.ok ? (
              <span className="text-emerald-700">All blocking steps are satisfied.</span>
            ) : (
              <span className="text-red-700">
                {v.readiness.blockingCount} blocking step(s) still fail.
              </span>
            )}{" "}
            Presentation hash now <span className="num">{v.readiness.presentationHash.slice(0, 12)}</span>, return fingerprint{" "}
            <span className="num">{v.readiness.returnFingerprint.slice(0, 12)}</span>.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="px-5 py-2 font-normal">Step</th>
              <th className="px-2 py-2 font-normal">Status</th>
              <th className="px-2 py-2 font-normal">Kind</th>
              <th className="px-2 py-2 font-normal">Detail</th>
              <th className="px-2 py-2 font-normal">References</th>
            </tr>
          </thead>
          <tbody>
            {v.readiness.items.map((item) => (
              <ReadinessRow key={item.step} item={item} />
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="font-medium">Actions</h2>
        <p className="mt-1 text-xs text-stone-500">
          Only the actions the current state allows are shown. Each is sent with revision <span className="num">{rev}</span>; the server checks who you are, the state and the
          prerequisites again.
        </p>
        {!anyAction ? <p className="mt-3 text-sm text-stone-600">No action is available in this state.</p> : null}
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {!v.banner.frozen && (v.banner.state === "preparing" || v.banner.state === "rejected" || v.banner.state === "amending") ? (
            <div className="rounded border border-stone-200 bg-stone-50 p-4">
              <h3 className="text-sm font-medium">Whole-return sign-off</h3>
              <p className="mt-1 text-xs text-stone-500">
                Required before presenting: a reviewer and a partner each sign off the whole return. The sign-off is fingerprinted over every line, the evidence, the open
                findings and the firm standard, and reopens if any of them changes. No one can sign off work they prepared.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <CommandButton revision={rev} type="sign_off" payload={{ scopeType: "return", scopeId: "*", level: "reviewer" }} className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700 disabled:opacity-50">
                  Sign off whole return as reviewer
                </CommandButton>
                <CommandButton revision={rev} type="sign_off" payload={{ scopeType: "return", scopeId: "*", level: "partner" }} className="rounded border border-stone-900 px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-50">
                  Sign off whole return as partner
                </CommandButton>
              </div>
            </div>
          ) : null}
          {v.actions.present.available ? <PresentForm revision={rev} gate={v.actions.present} /> : null}
          {v.actions.submit.available ? <SubmitPanel revision={rev} gate={v.actions.submit} /> : null}
          {v.actions.outcome.available ? awaiting.map((s) => <OutcomeForm key={s.id} revision={rev} submission={s} gate={v.actions.outcome} />) : null}
          {v.actions.amend.available ? <AmendForm revision={rev} gate={v.actions.amend} /> : null}
          {v.actions.nextYear.available ? <NextYearForm revision={rev} gate={v.actions.nextYear} /> : null}
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Submission attempts (simulated)</h2>
          <span className="text-xs text-stone-500">each attempt is immutable; a rejection leads to a new attempt</span>
        </div>
        {v.submissions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-stone-600">No submission yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="px-5 py-2 font-normal">Attempt</th>
                  <th className="px-2 py-2 font-normal">Jurisdiction</th>
                  <th className="px-2 py-2 font-normal">Status</th>
                  <th className="px-2 py-2 font-normal">Simulated submission ref</th>
                  <th className="px-2 py-2 font-normal">Errors</th>
                  <th className="px-2 py-2 font-normal">Submitted (business time)</th>
                  <th className="px-2 py-2 font-normal">Decided (business time)</th>
                  <th className="px-2 py-2 font-normal">Snapshot hash</th>
                </tr>
              </thead>
              <tbody>
                {v.submissions.map((s) => (
                  <SubmissionRow key={s.id} s={s} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Client approvals (simulated e-file authorization)</h2>
          <span className="text-xs text-stone-500">
            needed from {v.clientUsers.map((c) => c.name).join(" and ")}; each binds to a presentation hash
          </span>
        </div>
        {v.approvals.length === 0 ? (
          <p className="px-5 py-4 text-sm text-stone-600">No approval yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-5 py-2 font-normal">Person</th>
                <th className="px-2 py-2 font-normal">Signed at (business time)</th>
                <th className="px-2 py-2 font-normal">Presentation hash</th>
                <th className="px-2 py-2 font-normal">Status</th>
                <th className="px-2 py-2 font-normal">Invalidation reason</th>
              </tr>
            </thead>
            <tbody>
              {v.approvals.map((a) => (
                <tr key={a.id} className="border-t border-stone-100 align-top">
                  <td className="px-5 py-2">{a.personName}</td>
                  <td className="num px-2 py-2 text-xs">{dateTime(a.signedAt)}</td>
                  <td className="num px-2 py-2 text-xs" title={a.presentationHash}>
                    {a.presentationHash.slice(0, 12)}
                  </td>
                  <td className="px-2 py-2">
                    <StatusBadge status={a.status} simulated={a.simulated} />
                  </td>
                  <td className="px-2 py-2 text-xs text-stone-600">{a.invalidationReason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Frozen snapshots</h2>
          <span className="text-xs text-stone-500">never updated after insert; exports are self-contained documents</span>
        </div>
        {v.snapshots.length === 0 ? (
          <p className="px-5 py-4 text-sm text-stone-600">No snapshot yet. Presenting the return creates the first one.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-5 py-2 font-normal">Kind</th>
                <th className="px-2 py-2 font-normal">Revision</th>
                <th className="px-2 py-2 font-normal">Content hash</th>
                <th className="px-2 py-2 font-normal">Business time</th>
                <th className="px-2 py-2 font-normal">By</th>
                <th className="px-2 py-2 font-normal">Export</th>
              </tr>
            </thead>
            <tbody>
              {v.snapshots.map((s) => (
                <tr key={s.id} className="border-t border-stone-100 align-top">
                  <td className="px-5 py-2">
                    {s.kind.replace(/_/g, " ")}
                    <div className="num text-[11px] text-stone-400">{s.id}</div>
                  </td>
                  <td className="num px-2 py-2">{s.revision}</td>
                  <td className="num px-2 py-2 text-xs" title={s.contentHash}>
                    {s.contentHash.slice(0, 16)}
                  </td>
                  <td className="num px-2 py-2 text-xs">{dateTime(s.businessTime)}</td>
                  <td className="px-2 py-2 text-xs">{s.createdByName}</td>
                  <td className="px-2 py-2 text-xs">
                    {s.exports.map((e) => (
                      <a key={e.href} href={e.href} className="mr-3 text-blue-700 hover:underline">
                        {e.label}
                      </a>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="font-medium">Extension record (from the packet)</h2>
          <p className="mt-1 text-xs text-stone-500">
            Filed {v.extension.timeline ? dateTime(v.extension.timeline.at) : v.extension.computedAt}
            {v.extension.timeline?.actorName ? ` by ${v.extension.timeline.actorName}` : ""}, estimated from version <span className="num">{v.extension.basedOnVersion}</span>{" "}
            (computed {dateTime(v.extension.computedAt)}).{v.extension.timeline ? ` Timeline: ${v.extension.timeline.detail}` : ""}
          </p>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1 font-normal"></th>
                <th className="py-1 font-normal">Federal (Form 4868)</th>
                <th className="py-1 font-normal">California (FTB 3519)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-stone-100">
                <td className="py-1">Estimated total tax</td>
                <td className="num py-1">{money(v.extension.federal.estimatedTotalTax)}</td>
                <td className="num py-1">{money(v.extension.california.estimatedTotalTax)}</td>
              </tr>
              <tr className="border-t border-stone-100">
                <td className="py-1">Payments</td>
                <td className="num py-1">{money(v.extension.federal.payments)}</td>
                <td className="num py-1">{money(v.extension.california.payments)}</td>
              </tr>
              <tr className="border-t border-stone-100">
                <td className="py-1">Estimated balance</td>
                <td className="num py-1">{money(v.extension.federal.estimatedBalance)}</td>
                <td className="num py-1">{money(v.extension.california.estimatedBalance)}</td>
              </tr>
              <tr className="border-t border-stone-100 font-medium">
                <td className="py-1">Paid with the extension</td>
                <td className="num py-1">{money(v.extension.federal.paidWithForm4868)}</td>
                <td className="num py-1">{money(v.extension.california.paidWithFtb3519)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-stone-500">
            Rounding rule: {v.extension.federal.rule || "none supplied"} (federal); {v.extension.california.rule || "none supplied"} (California). California had an estimated overpayment, so
            nothing was paid with FTB 3519.
          </p>
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            {v.extension.payNote}
            {v.extension.rates.irsInterestAnnual !== null ? ` IRS underpayment interest ${(v.extension.rates.irsInterestAnnual * 100).toFixed(0)}% a year` : ""}
            {v.extension.rates.irsFailureToPayPerMonth !== null ? `, failure-to-pay ${(v.extension.rates.irsFailureToPayPerMonth * 100).toFixed(1)}% a month` : ""}
            {v.extension.rates.ftbLatePaymentPenalty ? `; FTB late payment ${v.extension.rates.ftbLatePaymentPenalty}` : ""}. The engine does not compute post-filing interest or penalties.
          </p>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="font-medium">Notice response</h2>
          <p className="mt-1 text-xs text-stone-500">
            Agency notices from the packet. A notice becomes available when the replay clock reaches its date; the bundle for a response is a self-contained document scoped to the items
            under examination.
          </p>
          <ul className="mt-3 space-y-3">
            {v.notices.map((n) => (
              <li key={n.id} className={`rounded border p-3 text-sm ${n.available ? "border-stone-200" : "border-dashed border-stone-300 text-stone-500"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {n.agency} {n.type}
                    {n.taxYear !== null ? ` for ${n.taxYear}` : ""}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${n.available ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}`}>{n.availabilityLabel}</span>
                </div>
                <div className="num mt-0.5 text-[11px] text-stone-400">
                  {n.id}
                  {n.documentId ? `, document ${n.documentId}` : ""}
                  {n.responseDue ? `, response due ${n.responseDue}` : ""}
                </div>
                {n.summary ? <p className="mt-1 text-xs">{n.summary}</p> : null}
                {n.status ? <p className="mt-1 text-xs">{n.status}</p> : null}
                {n.items.length ? (
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs">
                    {n.items.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ol>
                ) : null}
                {n.available ? (
                  <p className="mt-2 text-xs">
                    {n.exports.map((e) => (
                      <a key={e.href} href={e.href} className="mr-3 text-blue-700 hover:underline">
                        {e.label}
                      </a>
                    ))}
                  </p>
                ) : (
                  <p className="mt-2 text-xs">
                    The bundle export appears once the clock passes {n.dated}. Move the clock from the{" "}
                    <Link href="/changes/timeline" className="text-blue-700 hover:underline">
                      timeline
                    </Link>
                    .
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
