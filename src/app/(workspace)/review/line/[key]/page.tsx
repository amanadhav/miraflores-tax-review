import Link from "next/link";
import { notFound } from "next/navigation";
import { AdjustmentForm } from "@/components/adjustment-form";
import { AdjustmentHistory } from "@/components/adjustment-history";
import { FindingList } from "@/components/finding-list";
import { JudgmentForm } from "@/components/judgment-form";
import { RefLink } from "@/components/ref-link";
import { RefBadge, RefList } from "@/components/line-refs";
import { formatLineValue, LineStatusBadge } from "@/components/line-value";
import { LineVerificationForm } from "@/components/line-verification-form";
import { SignoffPanel } from "@/components/signoff-panel";
import { dateOnly } from "@/lib/format";
import { lineView, type CalculationInput, type LineRef } from "@/server/queries/review";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function lineHref(key: string): string {
  return `/review/line/${encodeURIComponent(key)}`;
}

function InputRow({ input }: { input: CalculationInput }) {
  return (
    <tr className="border-t border-stone-100">
      <td className="num py-1 pr-2 text-right text-stone-500">{input.sign === undefined ? "" : input.sign < 0 ? "minus" : "plus"}</td>
      <td className="py-1 pr-3">
        {input.present ? (
          <Link href={lineHref(input.key)} className="hover:underline">
            {input.label}
          </Link>
        ) : (
          <span className="text-stone-500">{input.label} (not in this version)</span>
        )}
        <span className="num ml-2 text-[11px] text-stone-400">{input.key}</span>
        {input.sign !== undefined && !input.signVerified ? <span className="ml-2 text-[11px] text-stone-400">(zero input; sign not verifiable)</span> : null}
      </td>
      <td className="num py-1 pr-3 text-right">{formatLineValue(input.effective)}</td>
      <td className="py-1">
        <LineStatusBadge status={input.status} reason={`${input.label} is ${input.status}`} />
      </td>
    </tr>
  );
}

function LineRefList({ items, empty }: { items: LineRef[]; empty: string }) {
  if (items.length === 0) return <span className="text-xs text-stone-400">{empty}</span>;
  return (
    <ul className="space-y-0.5 text-xs">
      {items.map((d) => (
        <li key={d.key} className="flex flex-wrap items-center gap-2">
          <Link href={lineHref(d.key)} className="hover:underline">
            {d.label}
          </Link>
          <span className="num text-stone-400">{d.key}</span>
          <span className="num">{formatLineValue(d.effective)}</span>
          <LineStatusBadge status={d.status} reason={`${d.label} is ${d.status}`} />
        </li>
      ))}
    </ul>
  );
}

function Panel({ id, title, children, hint }: { id: string; title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section id={id} className="rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="font-medium">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs text-stone-500">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** The inspector for one return line: value, calculation, evidence, history and reviews. */
export default async function LinePage({ params }: { params: Promise<{ key: string }> }) {
  const ctx = await requireSessionContext();
  const { key } = await params;
  const v = await lineView(ctx, decodeURIComponent(key));
  if (!v) notFound();
  const changed = v.value.baseline !== v.value.effective;

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs text-stone-500">
          <Link href="/review" className="hover:underline">
            Review
          </Link>{" "}
          /{" "}
          <Link href={`/review?area=${encodeURIComponent(v.area.id)}`} className="hover:underline">
            {v.area.label}
          </Link>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{v.label}</h1>
        <p className="mt-1 text-sm text-stone-600">
          <span className="num">{v.key}</span>: {v.form} line {v.line}, {v.jurisdiction === "california" ? "California" : "federal"}. Acting as {v.actor.name} ({v.actor.role}),
          revision <span className="num">{v.revision}</span>.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="value" title="Value and status">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-stone-500">Engine baseline</dt>
            <dd className="num">{formatLineValue(v.value.baseline)}</dd>
            <dt className="text-stone-500">Effective now</dt>
            <dd className={`num ${changed ? "font-medium" : ""}`}>{formatLineValue(v.value.effective)}</dd>
            <dt className="text-stone-500">Status</dt>
            <dd>
              <LineStatusBadge status={v.value.status} reason={v.value.statusReason} />
              <p className="mt-1 text-xs text-stone-600">{v.value.statusReason}</p>
              {v.value.adjustmentId ? (
                <p className="mt-1 text-xs">
                  Set by{" "}
                  <Link href={`#${v.value.adjustmentId}`} className="num text-blue-700 hover:underline">
                    {v.value.adjustmentId}
                  </Link>
                </p>
              ) : null}
              {v.value.staleBecause.length > 0 ? (
                <div className="mt-1">
                  <span className="text-xs text-stone-500">Stale because these inputs changed:</span>
                  <LineRefList items={v.value.staleBecause} empty="" />
                </div>
              ) : null}
              {v.value.recomputedFrom.length > 0 ? (
                <div className="mt-1">
                  <span className="text-xs text-stone-500">Recomputed from:</span>
                  <LineRefList items={v.value.recomputedFrom} empty="" />
                </div>
              ) : null}
            </dd>
            <dt className="text-stone-500">Jurisdiction</dt>
            <dd>{v.jurisdiction === "california" ? "California" : "Federal"}</dd>
            <dt className="text-stone-500">Form and line</dt>
            <dd>
              {v.form} line {v.line}
            </dd>
            <dt className="text-stone-500">Engine rule</dt>
            <dd>
              <span className="num">{v.rule.id}</span>
              <p className="text-xs text-stone-600">{v.rule.description}</p>
            </dd>
            <dt className="text-stone-500">Engine note</dt>
            <dd className="text-xs text-stone-600">{v.note ?? "none"}</dd>
            <dt className="text-stone-500">Area</dt>
            <dd>
              <Link href={`/review?area=${encodeURIComponent(v.area.id)}`} className="hover:underline">
                {v.area.label}
              </Link>
            </dd>
            <dt className="text-stone-500">Used by</dt>
            <dd>
              <LineRefList items={v.dependents} empty="no other line uses this one" />
            </dd>
          </dl>
        </Panel>

        <Panel id="calculation" title="Calculation">
          {v.calculation.reproducible ? (
            <div className="text-sm">
              <p>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">verified {v.calculation.kind}</span>
                <span className="ml-2 text-xs text-stone-500">
                  engine rule <span className="num">{v.calculation.rule.id}</span>
                </span>
              </p>
              <p className="mt-2 font-medium">{v.calculation.formula}</p>
              {v.calculation.factor ? (
                <p className="mt-1 text-xs text-stone-600">
                  Factor <span className="num">{v.calculation.factor.value}</span> from <RefLink refId={v.calculation.factor.ref} label={v.calculation.factor.label} />
                </p>
              ) : null}
              <p className="mt-1 text-xs text-stone-600">{v.calculation.statement}</p>
            </div>
          ) : (
            <div className="text-sm">
              <p>
                <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-700">opaque</span>
              </p>
              <p className="mt-2 font-medium">{v.calculation.formula}</p>
              {v.calculation.reason ? <p className="mt-1 text-xs text-stone-600">Why no formula is claimed: {v.calculation.reason}</p> : null}
              <p className="mt-1 text-xs text-amber-800">{v.calculation.statement}</p>
            </div>
          )}
          {v.calculation.inputs.length > 0 ? (
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="py-1 pr-2 font-normal"></th>
                  <th className="py-1 pr-3 font-normal">Input line</th>
                  <th className="py-1 pr-3 text-right font-normal">Effective</th>
                  <th className="py-1 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {v.calculation.inputs.map((i) => (
                  <InputRow key={i.key} input={i} />
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-3 text-xs text-stone-500">No input lines: the value comes from the sources listed under Evidence or from the engine.</p>
          )}
        </Panel>

        <Panel id="evidence" title="Evidence" hint={`Availability is judged at the replay clock, ${dateOnly(v.evidence.asOf)}.`}>
          <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide">Sources ({v.evidence.sources.length})</h3>
          <div className="mt-1">
            <RefList items={v.evidence.sources} empty="The engine lists no sources for this line." />
          </div>
          <h3 className="mt-4 text-xs font-medium text-stone-500 uppercase tracking-wide">Anchors ({v.evidence.anchors.length})</h3>
          {v.evidence.anchors.length === 0 ? (
            <p className="mt-1 text-xs text-stone-400">No exact text anchors yet.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {v.evidence.anchors.map((a) => (
                <li key={a.id} id={a.id}>
                  <RefLink refId={a.ref} label={a.label} />
                  <span className="ml-2 text-xs text-stone-700">&quot;{a.textSpan}&quot;</span>
                  <span className="ml-2 text-xs text-stone-500">
                    {a.origin === "manual" ? "anchored" : "matched"} by {a.createdBy.name} at revision <span className="num">{a.createdRevision}</span>
                    {a.note ? `: ${a.note}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-4 text-xs font-medium text-stone-500 uppercase tracking-wide">Verifications ({v.evidence.verifications.length})</h3>
          {v.evidence.verifications.length === 0 ? (
            <p className="mt-1 text-xs text-stone-400">Not yet verified.</p>
          ) : (
            <ul className="mt-1 space-y-1.5 text-sm">
              {v.evidence.verifications.map((ver) => (
                <li key={ver.id} id={ver.id} className="rounded border border-stone-100 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${ver.conclusion === "agrees" ? "bg-emerald-100 text-emerald-800" : ver.conclusion === "disagrees" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                      {ver.conclusion}
                    </span>
                    <span className="font-medium">{ver.methodLabel}</span>
                    <span className="text-xs text-stone-500">
                      {ver.actor.name} ({ver.actor.role}), revision <span className="num">{ver.createdRevision}</span>, {dateOnly(ver.createdAt)}
                    </span>
                  </div>
                  {ver.note ? <p className="mt-1 text-xs text-stone-700">{ver.note}</p> : null}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {ver.evidenceRefs.map((r) => (
                      <RefBadge key={r.ref} item={r} showRef={false} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <LineVerificationForm subjectRef={v.key} revision={v.revision} methods={v.evidence.verificationTypes} sources={v.evidence.sources} canVerify={v.actor.canVerify} actorRole={v.actor.role} />
          </div>
        </Panel>

        <Panel id="reviews" title="Reviews">
          <div className="space-y-5">
            <SignoffPanel panel={v.reviews.line} revision={v.revision} title="This line" />
            <SignoffPanel panel={v.reviews.area} revision={v.revision} title={`Area: ${v.reviews.area.scopeLabel}`} />
          </div>
        </Panel>
      </div>

      <Panel id="history" title={`History (${v.history.length})`} hint="Every proposal on this line in the order made, with its estimated effect and decision. Nothing is deleted.">
        <AdjustmentHistory items={v.history} revision={v.revision} />
      </Panel>

      {v.findings.length > 0 ? (
        <Panel id="findings" title={`Findings referencing this line (${v.findings.length})`}>
          <FindingList findings={v.findings} focusId={null} revision={v.revision} canResolve={false} actorRole={v.actor.role} compact />
          <p className="mt-2 text-xs text-stone-500">
            Resolve findings from the{" "}
            <Link href={`/review?area=${encodeURIComponent(v.area.id)}`} className="text-blue-700 hover:underline">
              area view
            </Link>
            .
          </p>
        </Panel>
      ) : null}

      <Panel id="propose" title="Propose an adjustment" hint="Records a proposed change with its reason, evidence and an estimated tax effect. The engine baseline is never edited.">
        <AdjustmentForm
          targetRef={v.key}
          lineLabel={v.label}
          currentValue={v.value.effective}
          jurisdiction={v.jurisdiction}
          revision={v.revision}
          sources={v.evidence.sources}
          defaults={v.propose.defaults}
          categories={v.propose.categories}
          canPropose={v.propose.canPropose}
          actorRole={v.actor.role}
        />
      </Panel>

      <Panel id="judgment" title="Record a judgment" hint="A judgment call, election, due diligence record or penalty decision on this line, with the authority relied on and its evidence.">
        <JudgmentForm revision={v.revision} canRecord={v.actor.canVerify} actorRole={v.actor.role} subjectRef={v.key} subjectLabel={v.label} lockSubject evidence={v.evidence.sources} defaultArea={v.area.id} compact />
        <p className="mt-2 text-xs">
          <Link href="/review/judgments" className="text-blue-700 hover:underline">
            All judgments and the packet&apos;s open judgment items
          </Link>
        </p>
      </Panel>
    </div>
  );
}
