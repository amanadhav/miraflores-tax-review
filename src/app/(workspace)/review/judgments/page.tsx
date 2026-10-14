import Link from "next/link";
import { JudgmentForm } from "@/components/judgment-form";
import { RefBadge, RefInline } from "@/components/line-refs";
import { dateOnly } from "@/lib/format";
import { judgmentsView, type JudgmentView } from "@/server/queries/judgments";
import { isRefusal } from "@/server/queries/people";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function href(p: { kind?: string | null; area?: string | null }): string {
  const q = new URLSearchParams();
  if (p.kind) q.set("kind", p.kind);
  if (p.area) q.set("area", p.area);
  const s = q.toString();
  return s ? `/review/judgments?${s}` : "/review/judgments";
}

function FilterChip({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link href={href} className={`rounded-full border px-2.5 py-0.5 ${active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100"}`}>
      {label}
    </Link>
  );
}

function KindBadge({ kind, label }: { kind: string; label: string }) {
  const tone = kind === "election" ? "bg-blue-100 text-blue-800" : kind === "due_diligence" ? "bg-emerald-100 text-emerald-800" : kind === "penalty_decision" ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-700";
  return <span className={`rounded px-1.5 py-0.5 text-xs ${tone}`}>{label}</span>;
}

function JudgmentCard({ j }: { j: JudgmentView }) {
  return (
    <li id={j.id} className={`px-5 py-4 ${j.status === "superseded" ? "text-stone-500" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <KindBadge kind={j.kind} label={j.kindLabel} />
        <span className={`font-medium ${j.status === "superseded" ? "line-through decoration-stone-300" : ""}`}>{j.title}</span>
        {j.status === "superseded" ? <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">superseded</span> : null}
        <span className="ml-auto num text-xs text-stone-400">{j.id}</span>
      </div>
      <div className="mt-1 text-xs text-stone-500">
        Subject <RefBadge item={j.subject} /> in {j.areaLabel}. Decided by {j.decidedBy.name} ({j.decidedBy.role}) at revision <span className="num">{j.createdRevision}</span>, {dateOnly(j.createdAt)}
        {j.mine ? " (you)" : ""}.
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-stone-500">Authority</dt>
        <dd>{j.authority}</dd>
        <dt className="text-stone-500">Applicability</dt>
        <dd className="whitespace-pre-wrap">{j.applicability}</dd>
        <dt className="text-stone-500">Conclusion</dt>
        <dd className="whitespace-pre-wrap font-medium">{j.conclusion}</dd>
        {j.consequences ? (
          <>
            <dt className="text-stone-500">Consequences</dt>
            <dd className="whitespace-pre-wrap">{j.consequences}</dd>
          </>
        ) : null}
        <dt className="text-stone-500">Evidence</dt>
        <dd>
          <RefInline items={j.evidenceRefs} />
        </dd>
        {j.checklist ? (
          <>
            <dt className="text-stone-500">
              Checklist <span className="num">{j.checklistDone}</span>/<span className="num">{j.checklist.length}</span>
            </dt>
            <dd>
              <ul className="space-y-0.5 text-xs">
                {j.checklist.map((c, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={`mt-0.5 inline-block h-3 w-3 rounded border ${c.done ? "border-emerald-600 bg-emerald-500" : "border-stone-400 bg-white"}`} aria-label={c.done ? "done" : "not done"} />
                    <span>
                      {c.item}
                      {c.note ? <span className="text-stone-500">: {c.note}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
        {j.supersedesId || j.supersededById ? (
          <>
            <dt className="text-stone-500">Revision</dt>
            <dd className="text-xs">
              {j.supersedesId ? (
                <span>
                  Supersedes{" "}
                  <a href={`#${j.supersedesId}`} className="num text-blue-700 hover:underline">
                    {j.supersedesId}
                  </a>
                </span>
              ) : null}
              {j.supersedesId && j.supersededById ? "; " : ""}
              {j.supersededById ? (
                <span>
                  superseded by{" "}
                  <a href={`#${j.supersededById}`} className="num text-blue-700 hover:underline">
                    {j.supersededById}
                  </a>
                </span>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>
    </li>
  );
}

/** Every judgment, election, due diligence record and penalty decision, and the packet's open judgment items as suggested subjects. */
export default async function JudgmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSessionContext();
  const sp = await searchParams;
  const v = await judgmentsView(ctx, { kind: one(sp.kind), area: one(sp.area) });
  if (isRefusal(v)) {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Judgments</h1>
        <p className="text-sm text-stone-600">{v.message}</p>
      </div>
    );
  }
  const f = v.filters;

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs text-stone-500">
          <Link href="/review" className="hover:underline">
            Review
          </Link>{" "}
          / Judgments
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Judgments, elections, due diligence and penalty decisions</h1>
        <p className="mt-1 text-sm text-stone-600">
          <span className="num">{v.total}</span> recorded against return {v.version}. Every record names the authority relied on, how it applies, the conclusion and its evidence. Recording one is preparation work: the person who records it
          cannot later review or sign off that scope. Evidence availability is judged at the replay clock, <span className="num">{dateOnly(v.asOf)}</span>.
        </p>
      </section>

      <section className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-stone-500">Kind:</span>
        <FilterChip active={!f.kind} href={href({ area: f.area })} label={`all ${v.total}`} />
        {v.kinds.map((k) => (
          <FilterChip key={k.value} active={f.kind === k.value} href={href({ kind: k.value, area: f.area })} label={`${k.label} ${v.counts.byKind[k.value]}`} />
        ))}
        <span className="ml-4 text-stone-500">Area:</span>
        <FilterChip active={!f.area} href={href({ kind: f.kind })} label="all areas" />
        {v.areas.map((a) => (
          <FilterChip key={a.id} active={f.area === a.id} href={href({ kind: f.kind, area: a.id })} label={`${a.label}${v.counts.byArea.find((x) => x.id === a.id) ? ` ${v.counts.byArea.find((x) => x.id === a.id)!.count}` : ""}`} />
        ))}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Recorded</h2>
          <span className="text-xs text-stone-500">{v.judgments.length} shown</span>
        </div>
        {v.judgments.length === 0 ? <p className="px-5 py-4 text-sm text-stone-500">Nothing recorded yet for these filters.</p> : <ul className="divide-y divide-stone-100">{v.judgments.map((j) => <JudgmentCard key={j.id} j={j} />)}</ul>}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Open judgment items from the packet</h2>
          <p className="mt-0.5 text-xs text-stone-500">
            Each item names the question and the evidence that bears on it, so a decision can be recorded quickly. The evidence is offered, never the answer: the authority, applicability and conclusion are yours. Evidence that arrives after the replay
            clock is shown but cannot be cited yet.
          </p>
        </div>
        <ul className="divide-y divide-stone-100">
          {v.suggestions.map((s) => (
            <li key={s.id} id={`suggest-${s.id}`} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <KindBadge kind={s.suggestedKind} label={`suggested: ${s.suggestedKind.replace(/_/g, " ")}`} />
                <span className="font-medium">{s.title}</span>
                <span className="text-xs text-stone-500">{s.areaLabel}</span>
                {s.recorded.length > 0 ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">{s.recorded.length} recorded</span> : null}
              </div>
              <p className="mt-1 text-sm text-stone-700">{s.question}</p>
              <div className="mt-1 text-xs text-stone-500">
                Subject <RefBadge item={s.subject} />
              </div>
              <div className="mt-1 text-xs">
                <span className="text-stone-500">Evidence: </span>
                <RefInline items={s.evidence} />
              </div>
              {s.links.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-3 text-xs">
                  {s.links.map((l) => (
                    <Link key={l.href} href={l.href} className="text-blue-700 hover:underline">
                      {l.label}
                    </Link>
                  ))}
                </div>
              ) : null}
              {s.recorded.length > 0 ? (
                <ul className="mt-1 text-xs text-stone-600">
                  {s.recorded.map((r) => (
                    <li key={r.id}>
                      <a href={`#${r.id}`} className="text-blue-700 hover:underline">
                        {r.kindLabel}: {r.title}
                      </a>{" "}
                      by {r.decidedBy} at revision <span className="num">{r.createdRevision}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-2">
                <JudgmentForm
                  revision={v.revision}
                  canRecord={v.actor.canRecord}
                  actorRole={v.actor.role}
                  subjectRef={s.subject.ref}
                  subjectLabel={s.subject.label}
                  lockSubject
                  defaultKind={s.suggestedKind}
                  defaultTitle={s.title}
                  question={s.question}
                  evidence={s.evidence}
                  defaultArea={s.area}
                  compact
                  openLabel="Record a decision on this"
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="font-medium">Record on any subject</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          For a subject not listed above: a line key (for example <span className="num">SchE.14A</span>), an extracted value, a document or a household member. A line&apos;s own inspector also has this form; find a line from the{" "}
          <Link href="/review" className="text-blue-700 hover:underline">
            review area
          </Link>{" "}
          or by{" "}
          <Link href="/search" className="text-blue-700 hover:underline">
            search
          </Link>
          .
        </p>
        <div className="mt-3">
          <JudgmentForm revision={v.revision} canRecord={v.actor.canRecord} actorRole={v.actor.role} areas={v.areas} compact openLabel="Record judgment" />
        </div>
      </section>
    </div>
  );
}
